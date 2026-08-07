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
// last describe block below drives exactly that.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENAMED_DEFS } from './lib/renamed-defs';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import {
  MIGRATIONS_BY_MAJOR,
  RETIRED_DEFS_BY_MAJOR,
  RETIRED_KEYS_BY_MAJOR,
} from '../src/migrations/registry';
import {
  AUTHORABLE_SURFACE_DIR_NAME,
  SCHEMA_MANIFEST_DIR_NAME,
  aggregateCategoryShards,
  authorableSurfaceShardTexts,
  schemaManifestShardTexts,
  writeShards,
} from './lib/sharded-artifacts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');

/**
 * Both ratchets are DIRECTORIES since #5837 (one shard per category), so every
 * fixture here writes a shard set and every "the file was not touched"
 * assertion compares the whole set's bytes. That is the same assertion it always
 * was: the gate reads the directory as one set, so "these exact bytes, still"
 * means the same thing it meant about one file.
 */
function shardBytes(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .sort()
    .map((f) => `=== ${f} ===\n${fs.readFileSync(path.join(dir, f), 'utf8')}`)
    .join('');
}

/** Write a key set as canonical authorable-surface shards; returns the bytes. */
function writeSurfaceShards(dir: string, keys: readonly string[]): string {
  writeShards(dir, authorableSurfaceShardTexts([...keys].sort()));
  return shardBytes(dir);
}

/** Write a def-key set as canonical manifest shards; returns the bytes. */
function writeManifestShards(dir: string, schemas: readonly string[]): string {
  writeShards(dir, schemaManifestShardTexts([...schemas].sort()));
  return shardBytes(dir);
}

/** Aggregate a shard directory back into its sorted key set. */
function readShardKeys(dir: string, field: 'keys' | 'schemas'): string[] {
  return aggregateCategoryShards(dir, field)?.entries ?? [];
}

/**
 * Every run loads the entire spec surface and emits ~1700 JSON Schemas (~7s
 * alone, more under turbo's parallel test load). A timeout here should mean
 * "the script hung", not "the runner was busy" — cf. the same note in
 * check-react-blocks-declaration-parity.test.ts.
 */
const SPAWN_TIMEOUT_MS = 180_000;

/** The mark `authorable-surface.json` puts on a tombstoned key (build-schemas.ts). */
const RETIRED_MARK = ' [RETIRED]';
/** A schema key the committed manifest carries; dropping it fakes "one addition pending". */
const KNOWN_KEY = 'ui/View';
/** A key no build can emit — the `missing` (disappearance) ratchet's input. */
const PHANTOM_KEY = 'ui/ZzzNeverEmittedByAnyBuild';

let sandbox: string;
let script: string;
let manifestDir: string;
let surfaceDir: string;
let surfaceBasePath: string;
let pristine: string[];
let pristineSurface: string[];
/** The generator's own description line for the in-tree anchor, so fixtures
 *  written here are byte-canonical exactly the way `gen:schema` writes it —
 *  a hand-rolled string would trip the anchor's own hand-edit check (#5235). */
let surfaceBaseDescription: string;

/** Run git in the sandbox repo; throws on failure so a broken fixture is loud. */
function git(...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=build-schemas-test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd: sandbox, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  }
  return (r.stdout ?? '').trim();
}

/**
 * Write the in-tree anchor (#5235) in the generator's exact canonical form:
 * `{ description, baseRev, keys }`, two-space indent, trailing newline. Anything
 * else is a hand-edit as far as the gate is concerned, which is the point of the
 * file — so fixtures must go through here rather than patching bytes.
 */
function seedSurfaceBase(baseRev: string, mutate: (keys: string[]) => string[]): string {
  const keys = mutate([...pristineSurface]);
  const text = JSON.stringify({ description: surfaceBaseDescription, baseRev, keys }, null, 2) + '\n';
  fs.writeFileSync(surfaceBasePath, text);
  return text;
}

const readSurfaceBase = () => fs.readFileSync(surfaceBasePath, 'utf8');

beforeAll(() => {
  pristine = readShardKeys(path.join(PKG, SCHEMA_MANIFEST_DIR_NAME), 'schemas');
  pristineSurface = readShardKeys(path.join(PKG, AUTHORABLE_SURFACE_DIR_NAME), 'keys');
  expect(pristine.length, `${SCHEMA_MANIFEST_DIR_NAME}/ is empty — it is a committed artifact`).toBeGreaterThan(0);
  expect(pristineSurface.length, `${AUTHORABLE_SURFACE_DIR_NAME}/ is empty — it is a committed artifact`).toBeGreaterThan(0);
  const realBase = path.join(PKG, 'authorable-surface.base.json');
  if (!fs.existsSync(realBase)) {
    throw new Error(
      `packages/spec/authorable-surface.base.json is missing — it is a committed artifact (#5235). ` +
        `Run \`pnpm --filter @objectstack/spec gen:schema\` in a checkout that can reach origin/main.`,
    );
  }
  surfaceBaseDescription = (JSON.parse(fs.readFileSync(realBase, 'utf8')) as { description: string })
    .description;
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'build-schemas-check-'));
  fs.cpSync(path.join(PKG, 'scripts'), path.join(sandbox, 'scripts'), { recursive: true });
  for (const entry of ['src', 'node_modules', 'package.json']) {
    fs.symlinkSync(path.join(PKG, entry), path.join(sandbox, entry));
  }
  script = path.join(sandbox, 'scripts', 'build-schemas.ts');
  manifestDir = path.join(sandbox, SCHEMA_MANIFEST_DIR_NAME);
  surfaceDir = path.join(sandbox, AUTHORABLE_SURFACE_DIR_NAME);
  surfaceBasePath = path.join(sandbox, 'authorable-surface.base.json');
  // The authorable-surface ratchet runs after the manifest one; give it the
  // committed snapshot so a check that gets that far judges the same contract.
  writeSurfaceShards(surfaceDir, pristineSurface);
  // Anchor for the #4650 deletion check: a git repo whose origin/main holds the
  // committed baseline. Only the baseline is tracked — src/node_modules stay
  // symlinked, untracked reads the same as any dirty worktree.
  git('init', '-q', '-b', 'main', '.');
  git('add', AUTHORABLE_SURFACE_DIR_NAME);
  git('commit', '-q', '-m', `baseline: committed ${AUTHORABLE_SURFACE_DIR_NAME}/`);
  // The in-tree anchor (#5235), authentic by construction: it mirrors the
  // baseline at the commit just made, which stays reachable from origin/main for
  // every fixture below (this repo's history is linear).
  seedSurfaceBase(git('rev-parse', 'HEAD'), (k) => k);
  git('add', 'authorable-surface.base.json');
  git('commit', '-q', '-m', 'baseline anchor: committed authorable-surface.base.json');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});

afterAll(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

function run(args: string[] = []): { status: number; output: string } {
  const r = spawnSync(TSX, [script, ...args], {
    cwd: sandbox,
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Seed the sandbox manifest shards from the committed set; returns the bytes. */
function seedManifest(mutate: (schemas: string[]) => string[]): string {
  return writeManifestShards(manifestDir, mutate([...pristine]));
}

const readManifest = () => shardBytes(manifestDir);
const readManifestKeys = () => readShardKeys(manifestDir, 'schemas');

describe('build-schemas.ts --check — a check reports, it does not write (#4711)', () => {
  it(
    'fails on a manifest behind on additions, and leaves the file byte-identical',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(pristine).toContain(KNOWN_KEY);
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run(['--check']);

      // The exit code is half the fix: before #4711 this branch exited 0.
      expect(status).toBe(1);
      expect(output).toMatch(/json-schema\.manifest\/ is out of date \(1 schema\(s\) not recorded\)/);
      expect(output).toContain(`+ json-schema/${KNOWN_KEY}.json`);
      // The remedy must be the generator, exactly as the other seven artifacts say.
      expect(output).toMatch(/gen:schema/);
      // …and the file is the other half: not rewritten, not touched.
      expect(readManifest()).toBe(stale);
      expect(output).not.toContain('📒');
    },
  );

  it(
    'fails on a manifest still listing a def RENAMED_DEFS moved away, without writing it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The other half of the same condition, and the half that has no other
      // reporter: a renamed-away source key is deliberately NOT "missing" (the
      // disappearance ratchet excludes it, since the def is published under the
      // new name), so before #4711 the only thing that ever noticed it was the
      // silent rewrite. #4684 / #4703 both depend on that key actually leaving
      // the manifest.
      const [renamedSource] = Object.keys(RENAMED_DEFS);
      // Loud on purpose: an empty table makes this branch dead code, which is a
      // decision (delete the branch, or the test) — not something to skip past.
      expect(renamedSource, 'RENAMED_DEFS is empty — this test exercises nothing').toBeTruthy();
      const withStaleRename = seedManifest((s) => [...s, renamedSource].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(
        /json-schema\.manifest\/ is out of date .*1 renamed-away key\(s\) still listed/,
      );
      expect(output).toContain(`- json-schema/${renamedSource}.json  (renamed away)`);
      expect(readManifest()).toBe(withStaleRename);
    },
  );

  it(
    'keeps the disappearance ratchet intact: a schema in the manifest that no build emits still exits 1',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const withPhantom = seedManifest((s) => [...s, PHANTOM_KEY].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 previously published schema\(s\) disappeared from this build/);
      expect(output).toContain(`- json-schema/${PHANTOM_KEY}.json`);
      expect(readManifest()).toBe(withPhantom);
    },
  );

  it(
    'still writes the manifest outside --check, so gen:schema keeps recording additions',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(output).toContain('📒 json-schema.manifest/ updated (+1 schema(s) across 1 shard(s))');
      expect(readManifest()).not.toBe(stale);
      expect(readManifestKeys()).toContain(KNOWN_KEY);
    },
  );

  it(
    'is silent about the manifest when it is up to date — the new failure is staleness, not --check itself',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Negative control. Without it, "always exit 1 in check mode" would pass
      // every assertion above while breaking the gate for everyone.
      // NOTE: this asserts status 0, so it also re-proves that the COMMITTED
      // manifest and authorable-surface snapshots are current — the same thing
      // `check:authorable-surface` asserts in CI. If it fails here, run
      // `pnpm --filter @objectstack/spec gen:schema` and commit the result.
      const current = seedManifest((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toMatch(/json-schema\.manifest\/ is out of date/);
      expect(output).not.toContain('📒');
      expect(readManifest()).toBe(current);
      expect(status).toBe(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #4650 — a deleted authorable-surface line must prove itself.
//
// Checks (a)/(b) read authorable-surface.json from the SAME commit, so deleting
// a baseline line deleted the evidence they run on: #4638 and #4643 removed
// authorable keys with zero registered conversions and a green gate. Check (c)
// re-anchors deletions on the baseline at the merge base with origin/main — a
// version the PR cannot rewrite — and demands one of three proofs: an aged-out
// registered tombstone, unreachability from the metadata-type roots (2026-08-02
// ruling), or the whole def leaving the build (the manifest ratchet's domain).
//
// Fixtures sabotage the BASE (extra lines committed under origin/main) while
// the worktree file stays canonical: set-wise identical to the real attack
// (line present at base, absent from the PR) without editing symlinked src/.
// The live end-to-end shape — delete a prop from src AND its baseline line —
// is exercised in the PR's recorded sabotage evidence instead.

const readSurface = () => shardBytes(surfaceDir);

/** Write a mutated baseline to the sandbox worktree; returns the exact bytes. */
function seedSurface(mutate: (keys: string[]) => string[]): string {
  return writeSurfaceShards(surfaceDir, mutate([...pristineSurface]));
}

/** Commit a BASE variant of the baseline and point origin/main at it. */
function seedBase(mutate: (keys: string[]) => string[]): string {
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
function minRegisteredMajorForLeaf(leaf: string): number | null {
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

const CURRENT_MAJOR = Number.parseInt(
  (JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')) as { version: string })
    .version,
  10,
);

/** Reachable def (BUILTIN root `object`), never tombstoned — the #4643 shape. */
const DELETED_LIVE = 'data/Object:zzNeverRetired4650';
/** Reachable def, tombstoned at base but never registered in the ADR-0087 registries. */
const DELETED_UNREGISTERED = 'data/Object:zzRetiredButUnregistered4650 [RETIRED]';
/** Tombstoned AND registered, but too recently: `skill.triggerPhrases` was
 *  registered at protocol 17. The guard below fails loudly once that ages out —
 *  re-pick a clause registered within the last TOMBSTONE_AGE_MAJORS majors. */
const DELETED_UNAGED_LEAF = 'triggerPhrases';
const DELETED_UNAGED = `ai/Agent:${DELETED_UNAGED_LEAF} [RETIRED]`;
/** Emitted but not reachable from any metadata-type root: a REST response
 *  envelope no metadata document is ever parsed against (the issue's own
 *  over-collection example). */
const DELETED_UNREACHABLE = 'api/SessionResponse:zzOverCollected4650';
/** Def the build no longer emits at all — the literal #4643 cluster. */
const DELETED_GONE_DEF = ['identity/Session:userId', 'identity/Session:token'];
/** Aged-out tombstone: `object.compactLayout` registered at protocol 11 —
 *  ≥ 2 majors behind any current major, so this fixture never goes stale. */
const DELETED_AGED_LEAF = 'compactLayout';
const DELETED_AGED = `data/Object:${DELETED_AGED_LEAF} [RETIRED]`;
/** Base key under a def RENAMED_DEFS moved: carried, so never a deletion.
 *  Was `integration/RateLimitConfig:maxRequests` until #4911 retired that def
 *  outright and its rename entry was absorbed (a rename whose target stops
 *  being emitted cannot stay in the table). Re-pointed at the #4703 rename,
 *  which carries 7 keys — an ENUM rename (0 keys carried) would make this
 *  fixture vacuous. */
const DELETED_BY_RENAME_SOURCE_DEF = 'integration/FieldMapping';
const DELETED_BY_RENAME = `${DELETED_BY_RENAME_SOURCE_DEF}:source`;

describe('build-schemas.ts — deleted baseline lines must prove themselves (#4650)', () => {
  beforeAll(() => {
    // Fixture validity, asserted loudly instead of silently going stale.
    const keys = pristineSurface;
    for (const injected of [
      DELETED_LIVE,
      DELETED_UNREGISTERED,
      DELETED_UNAGED,
      DELETED_UNREACHABLE,
      ...DELETED_GONE_DEF,
      DELETED_AGED,
      DELETED_BY_RENAME,
    ]) {
      expect(
        keys.includes(injected) || keys.includes(injected.replace(' [RETIRED]', '')),
        `fixture ${injected} already exists in the committed baseline — pick another`,
      ).toBe(false);
    }
    expect(
      keys.some((k) => k.startsWith('identity/Session:')),
      'identity/Session is emitted again — the vanished-def fixture needs a new def',
    ).toBe(false);
    const unagedMajor = minRegisteredMajorForLeaf(DELETED_UNAGED_LEAF);
    expect(
      unagedMajor !== null && CURRENT_MAJOR - unagedMajor < 2,
      `'.${DELETED_UNAGED_LEAF}' (registered at major ${unagedMajor}) has aged out at major ` +
        `${CURRENT_MAJOR} — re-pick a clause registered within the last 2 majors`,
    ).toBe(true);
    const agedMajor = minRegisteredMajorForLeaf(DELETED_AGED_LEAF);
    expect(
      agedMajor !== null && CURRENT_MAJOR - agedMajor >= 2,
      `'.${DELETED_AGED_LEAF}' is no longer an aged-out registration`,
    ).toBe(true);
    // The manifest ratchet runs first; keep it current so every run reaches (c).
    seedManifest((s) => s);
  });

  it(
    'fails on deletions of reachable keys — live, unregistered, and not-yet-aged tombstones each say why',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBase((s) => [...s, DELETED_LIVE, DELETED_UNREGISTERED, DELETED_UNAGED].sort());
      const canonical = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(output).toMatch(/data\/Object:zzNeverRetired4650 — def reachable .* LIVE \(never tombstoned\)/);
      expect(output).toMatch(/data\/Object:zzRetiredButUnregistered4650 — .*tombstoned, but no conversion\/migration clause/);
      expect(output).toMatch(new RegExp(`ai/Agent:${DELETED_UNAGED_LEAF} — .*registered at major \\d+`));
      expect(output).toMatch(/must age ≥ 2 majors/);
      // The remedy names the retirement route, not a hand-edit.
      expect(output).toContain('gen:schema');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'still fails after the deletion is COMMITTED (the CI shape): the anchor is the merge base with origin/main, not HEAD',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      seedBase((s) => [...s, DELETED_LIVE].sort());
      const canonical = seedSurface((s) => s);
      // Commit the sabotaged (canonical-minus-line, relative to base) file so
      // the worktree is CLEAN — the state CI checks out. A `git show HEAD:`
      // anchor would now compare the commit to itself and never fire.
      git('add', AUTHORABLE_SURFACE_DIR_NAME);
      git('commit', '-q', '-m', 'PR commit deleting a baseline line');

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('deleted without proof (#4650)');
      expect(check.output).toContain(DELETED_LIVE);

      // Write mode (gen:schema) must refuse identically — regeneration cannot
      // bless a deletion either.
      const write = run([]);
      expect(write.status).toBe(1);
      expect(write.output).toContain('deleted without proof (#4650)');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'allows deletions that carry their own proof: unreachable def, vanished def, aged-out tombstone — each with its reason printed',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBase((s) => [...s, DELETED_UNREACHABLE, ...DELETED_GONE_DEF, DELETED_AGED].sort());
      const canonical = seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).toContain('baseline deletion(s) since');
      expect(output).toContain('carry their own proof (#4650)');
      // Narrow exception (2026-08-02 ruling): computed in-gate from the real
      // Zod graph, waiving ONLY the tombstone requirement.
      expect(output).toMatch(/api\/SessionResponse:zzOverCollected4650 — def not reachable from the \d+ metadata-type roots/);
      expect(output).toContain('BUILTIN_METADATA_TYPE_SCHEMAS + EXTRA_METADATA_TYPE_SCHEMAS');
      expect(output).toContain('not a license to change the schema');
      // Whole-def removal is the manifest ratchet's jurisdiction.
      expect(output).toContain('identity/Session:* (2 line(s))');
      expect(output).toContain('json-schema.manifest/ (#2978)');
      // Aged-out tombstone names its registration major.
      expect(output).toMatch(/data\/Object:compactLayout — \[RETIRED\] at [0-9a-f]+ and registered at major 11/);
      expect(output).toContain('tombstone aged out');
      expect(readSurface()).toBe(canonical);
      expect(status).toBe(0);
    },
  );

  it(
    'check (a) is intact: a key the BUILD stops emitting while still recorded is fatal before (c) ever runs',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const phantom = 'data/Object:zzPhantom4650';
      seedBase((s) => [...s, phantom].sort());
      const withPhantom = seedSurface((s) => [...s, phantom].sort());

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toMatch(/1 authorable key\(s\) disappeared from the contract/);
      expect(output).toContain(phantom);
      expect(output).not.toContain('deleted without proof');
      expect(readSurface()).toBe(withPhantom);
    },
  );

  it(
    'fails --check on a hand-edit that changes no key (generated-form mismatch, #4662), and write mode regenerates it',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      seedBase((s) => s);
      const canonical = seedSurface((s) => s);
      // One SHARD is hand-edited, not the whole set — the sharded shape of the
      // #4662 fixture, and a strictly narrower one: the gate has to name the
      // shard rather than notice the aggregate moved.
      const editedShard = path.join(surfaceDir, 'data.json');
      fs.writeFileSync(
        editedShard,
        fs
          .readFileSync(editedShard, 'utf8')
          .replace('Ratchet of every AUTHORABLE key', 'Ratchet  of every AUTHORABLE key'),
      );
      const handEdited = readSurface();
      expect(handEdited).not.toBe(canonical);

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('does not match its generated form');
      expect(check.output).toContain('~ authorable-surface/data.json  (stale)');
      expect(readSurface()).toBe(handEdited);

      const write = run([]);
      expect(write.status).toBe(0);
      expect(write.output).toContain('🔑 authorable-surface/ updated');
      expect(write.output).toContain('touched: data.json');
      expect(readSurface()).toBe(canonical);
    },
  );

  it(
    'fails LOUDLY when NO anchor of either kind is available — a deletion check that silently skips is the bypass again',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Until #5235 an unresolvable origin/main was fatal on its own. It no
      // longer is (the in-tree anchor takes over — see the #5235 block below),
      // but the property this test was written for is untouched and pinned here:
      // with NOTHING left to anchor on, the build fails rather than skipping.
      const head = seedBase((s) => s);
      seedSurface((s) => s);
      const anchor = readSurfaceBase();
      git('update-ref', '-d', 'refs/remotes/origin/main');
      fs.rmSync(surfaceBasePath);
      try {
        const { status, output } = run(['--check']);
        expect(status).toBe(1);
        expect(output).toContain('No baseline to anchor');
        expect(output).toContain('#4650');
        // Both remedies are named — neither is an env var.
        expect(output).toContain('authorable-surface.base.json');
        expect(output).toContain('git fetch origin main');
      } finally {
        fs.writeFileSync(surfaceBasePath, anchor);
        git('update-ref', 'refs/remotes/origin/main', head);
      }
    },
  );

  it(
    'a declared def rename is not a deletion: base keys are carried through RENAMED_DEFS before comparing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(Object.keys(RENAMED_DEFS)).toContain(DELETED_BY_RENAME_SOURCE_DEF);
      // The carried key must actually land under the NEW def, or this asserts
      // nothing — a rename entry whose target lost the key is check (a0)'s case.
      expect(pristineSurface).toContain(
        `${RENAMED_DEFS[DELETED_BY_RENAME_SOURCE_DEF]}:source`,
      );
      seedBase((s) => [...s, DELETED_BY_RENAME].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain('carry their own proof');
      expect(status).toBe(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5235 — the same gate, in a build that cannot reach GitHub.
//
// The #4650 anchor is `authorable-surface.json` at the merge base with
// origin/main, resolved out of git. Consumers that build a SHA-pinned framework
// tree inside an environment with no route to GitHub — cloud's buildx image
// stages, air-gapped builds, forks, historical-tag reproductions — cannot
// resolve it, and the gate failed the whole build there. Deleting
// `refs/remotes/origin/main` in the sandbox models exactly that (the sandbox has
// no `origin` remote either, so the self-heal fetch cannot rescue it).
//
// The fix is an in-tree anchor, and these tests pin the three properties that
// make it a fix rather than a bypass:
//
//   * offline, the gate RUNS against the committed anchor and still fails on an
//     unproven deletion (it is not "skip when git is unavailable");
//   * offline, nothing may WRITE the anchor — an offline build that could
//     advance it to its own state would be laundering the baseline;
//   * where origin/main IS reachable, the anchor is verified against it, so a
//     commit cannot edit the anchor to hide a deletion.
describe('build-schemas.ts — an in-tree anchor carries the deletion gate offline (#5235)', () => {
  /** Recorded in the anchor, emitted by no build: the offline gate's input. */
  const ONLY_AT_BASE = 'data/Object:zzOnlyInTreeAnchor5235';
  /** A real, reachable, live key — shedding it from the anchor is the attack. */
  const SHED_FROM_ANCHOR = 'data/Object:label';

  let head: string;

  beforeEach(() => {
    // A clean, current tree: manifest and worktree baseline canonical, and
    // origin/main holding that same baseline.
    seedManifest((s) => s);
    head = seedBase((s) => s);
    seedSurface((s) => s);
    seedSurfaceBase(head, (k) => k);
  });

  afterEach(() => {
    git('update-ref', 'refs/remotes/origin/main', head);
  });

  /** Run with no resolvable origin/main — the consumer/offline build shape. */
  function offline<T>(fn: () => T): T {
    git('update-ref', '-d', 'refs/remotes/origin/main');
    try {
      return fn();
    } finally {
      git('update-ref', 'refs/remotes/origin/main', head);
    }
  }

  it(
    'builds instead of failing when origin/main is unreachable, anchoring on the committed baseline',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = offline(() => run(['--check']));

      expect(status).toBe(0);
      // The #5235 fatal is gone…
      expect(output).not.toContain('Cannot resolve origin/main');
      expect(output).not.toContain('No baseline to anchor');
      // …and the run says which anchor it used, naming the commit it mirrors.
      expect(output).toContain('origin/main is not resolvable in this build environment');
      expect(output).toContain('authorable-surface.base.json');
      expect(output).toContain(head.slice(0, 12));
    },
  );

  it(
    'still fails offline on a deletion the anchor records and this build cannot account for',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Set-wise identical to the real attack: a line present at the base and
      // absent from the build's emitted surface. Check (a) reads the WORKTREE
      // baseline, which stays canonical, so only the anchored check (c) can see
      // this — which is the whole point of anchoring offline at all.
      seedSurfaceBase(head, (k) => [...k, ONLY_AT_BASE].sort());

      const { status, output } = offline(() => run(['--check']));

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toContain(ONLY_AT_BASE);
      expect(output).toMatch(/LIVE \(never tombstoned\)/);
    },
  );

  it(
    'never advances the anchor from an offline build — not on success, not on failure',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      // A LAGGING anchor: one key short of the current surface. A writer fed by
      // this build (rather than by a git-resolved baseline) would "helpfully"
      // top it up, and the next offline build would then be checking the tree
      // against itself. Write mode must leave it byte-identical.
      const lagging = seedSurfaceBase(head, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));

      const clean = offline(() => run([]));
      expect(clean.status).toBe(0);
      expect(readSurfaceBase()).toBe(lagging);

      // Same on the failing path: the anchor recording a key this build cannot
      // account for must not be rewritten into agreement with it.
      const planted = seedSurfaceBase(head, (k) => [...k, ONLY_AT_BASE].sort());
      const red = offline(() => run([]));
      expect(red.status).toBe(1);
      expect(red.output).toContain('deleted without proof (#4650)');
      expect(readSurfaceBase()).toBe(planted);
    },
  );

  it(
    'catches the anchor being edited to hide a deletion, wherever origin/main IS reachable',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(
        pristineSurface,
        `${SHED_FROM_ANCHOR} is no longer in the baseline — pick another live key`,
      ).toContain(SHED_FROM_ANCHOR);
      // The bypass this file exists to prevent, moved one file over: drop the
      // line from the anchor so an offline build would never miss it.
      seedSurfaceBase(head, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('is not the baseline it claims to be');
      expect(output).toContain(SHED_FROM_ANCHOR);
      // The remedy names the one command that may write this file — `gen:schema`
      // stopped being it at #5358, and a prescription pointing at a command that
      // no longer touches the file is the defect that issue is about.
      expect(output).toContain('gen:authorable-surface-base');
    },
  );

  it(
    'refuses an anchor pinned to a commit off origin/main — a rev the commit under test controls',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The other half of the same forgery: keep the keys honest, but point
      // baseRev at a LOCAL commit. Its baseline would match, so only the
      // ancestry test can tell it apart from an upstream one.
      git('commit', '-q', '--allow-empty', '-m', 'a commit this branch controls');
      const local = git('rev-parse', 'HEAD');
      expect(local).not.toBe(head);
      seedSurfaceBase(local, (k) => k);

      const { status, output } = run(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('NOT an ancestor of');
      expect(output).toContain(local.slice(0, 12));
    },
  );

  it(
    'does not mistake a shallow checkout for a forged baseRev — CI is shallow, and ancestry there is unwalkable',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The shape that broke this change's own first CI run. CI checks out
      // depth 1, the anchor's commit is fetched as its own shallow root, and
      // `merge-base --is-ancestor` then answers "not an ancestor" about a commit
      // that plainly is one. Trusting that answer fails every build.
      //
      // `$GIT_DIR/shallow` is what makes a repository shallow, so writing the
      // current tip into it truncates history exactly the way `--depth=1` does —
      // no clone, and `git show BASEREV:file` still works, which is what keeps
      // the KEYS half of the verification alive here.
      const older = head;
      const tip = seedBase((s) => s);
      seedSurface((s) => s);
      seedSurfaceBase(older, (k) => k);
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${tip}\n`);
      try {
        expect(git('rev-parse', '--is-shallow-repository')).toBe('true');
        const { status, output } = run(['--check']);

        expect(output).toContain('shallow checkout');
        expect(output).not.toContain('NOT an ancestor of');
        expect(status).toBe(0);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'still compares the anchor keys in a shallow checkout — the half that survives truncation',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const older = head;
      const tip = seedBase((s) => s);
      seedSurface((s) => s);
      seedSurfaceBase(older, (k) => k.filter((x) => x !== SHED_FROM_ANCHOR));
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${tip}\n`);
      try {
        const { status, output } = run(['--check']);

        expect(status).toBe(1);
        expect(output).toContain('is not the baseline it claims to be');
        expect(output).toContain(SHED_FROM_ANCHOR);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'is a committed artifact: --check reports it missing without writing it, and only --update-base creates it',
    { timeout: SPAWN_TIMEOUT_MS * 3 },
    () => {
      fs.rmSync(surfaceBasePath);

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('authorable-surface.base.json is missing');
      // A check reports; it does not repair (#4711).
      expect(fs.existsSync(surfaceBasePath)).toBe(false);

      // A plain build says so loudly and still does not create it (#5358) — the
      // gate above is where a missing committed artifact goes red, not here.
      const build = run([]);
      expect(build.status).toBe(0);
      expect(build.output).toContain('a build no longer creates it (#5358)');
      expect(build.output).toContain('gen:authorable-surface-base');
      expect(fs.existsSync(surfaceBasePath)).toBe(false);

      const write = run(['--update-base']);
      expect(write.status).toBe(0);
      expect(write.output).toContain('authorable-surface.base.json created at');
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      // Written from the git-resolved baseline — the merge base, not this tree.
      expect(doc.baseRev).toBe(head);
      expect(doc.keys).toEqual(pristineSurface);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5358 — the anchor moves only when a human asks for it.
//
// #5235 gave the anchor two properties: it may only be written from a
// git-resolved baseline, and it is verified against origin/main wherever that is
// reachable. Both are about WHAT gets written. Neither says WHEN — and the answer
// was "on every run that regenerates", which meant every `pnpm build`, every
// `pnpm --filter '<pkg>^...' build` whose closure contains @objectstack/spec, and
// every `check:docs` (whose first step is `gen:schema`).
//
// Three developers reported the consequence independently, from three unrelated
// tasks (#4990, #5155, #5660): a file they had never opened showed up modified in
// `git status`, with `baseRev` advanced to the tip they branched from. Twice the
// same run also dropped 110 keys — the `ui/ComponentAnimation` family #4988/#5321
// had just retired. An anchor advanced past a retirement is an anchor that can no
// longer SEE that retirement, and the #4650 deletion gate is green before and
// after, because both states are internally consistent. The only thing standing
// between that and a merged PR was three people reading `git diff` line by line.
//
// The fix is a mode, not a smarter heuristic: `--update-base` writes the anchor,
// and nothing else does. What these tests pin is the negative — that a run which
// is NOT that mode leaves the working tree exactly as it found it — because that
// is the property `git add -A` can silently violate.
describe('build-schemas.ts — only --update-base moves the in-tree anchor (#5358)', () => {
  /** A live key held back from the older commit, so the anchor legitimately lags. */
  const LAGGING_KEY = 'data/Object:label';

  let older: string;
  let tip: string;
  let laggingAnchor: string;

  beforeEach(() => {
    // The real-world shape, built honestly: an OLDER upstream commit whose
    // baseline is one key short, then the current origin/main tip carrying the
    // full baseline. The anchor mirrors the older commit — authentic (its keys ARE
    // that commit's baseline) and legitimately behind the merge base, which is
    // exactly the state every checkout is in right after a surface change lands.
    seedManifest((s) => s);
    older = seedBase((s) => s.filter((k) => k !== LAGGING_KEY));
    tip = seedBase((s) => s);
    seedSurface((s) => s);
    laggingAnchor = seedSurfaceBase(older, (k) => k.filter((x) => x !== LAGGING_KEY));
    // Commit the fixture so the tree is CLEAN — `git diff --exit-code` is the
    // acceptance criterion, and it can only mean something from a clean start.
    // Only the two tracked artifacts: `git add -A` here would track the ~1600-file
    // json-schema/ output, which every subsequent run rewrites, and the cleanliness
    // assertions below would then measure the generator's own scratch space.
    git('add', 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: lagging but authentic anchor');
    git('update-ref', 'refs/remotes/origin/main', tip);
    expect(git('status', '--porcelain', '-uno')).toBe('');
  });

  afterEach(() => {
    git('update-ref', 'refs/remotes/origin/main', tip);
  });

  it(
    'a plain build leaves the anchor byte-identical and the working tree clean',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // THE regression test. Before #5358 this run rewrote the anchor to
      // {baseRev: tip, keys: full} and exited 0, so `git status` showed a file the
      // build's author never touched. `gen:schema` is `pnpm build`'s first step,
      // which is why an unrelated PR was one `git add -A` away from carrying it.
      const { status, output } = run([]);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      // Silent is not enough: the run says the anchor lags, that this is not an
      // error, and what the deliberate act would be.
      expect(output).toContain('trails the baseline at');
      expect(output).toContain('not an error');
      expect(output).toContain('gen:authorable-surface-base');
      expect(output).not.toContain('⚓');
    },
  );

  it(
    'a --check run leaves the anchor byte-identical and the working tree clean',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The literal acceptance criterion of #5358: run the gate on a clean tree,
      // then `git diff --exit-code`. Unlike the case above this one already held
      // on `main` — the anchor's write branch was `!CHECK` before this change too
      // — so it is a pin, not a repair. It is here because "a check is read-only"
      // is the property the whole file exists for (#4711), and the entry point
      // that violated it was the neighbouring one.
      const { status } = run(['--check']);

      expect(status).toBe(0);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    '--update-base re-anchors to the git-resolved baseline, and says so',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = run(['--update-base']);

      expect(status).toBe(0);
      expect(output).toContain('⚓');
      expect(output).toContain(tip.slice(0, 12));
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      // From the merge base, never from this build's own emitted surface (#5235).
      expect(doc.baseRev).toBe(tip);
      expect(doc.keys).toEqual(pristineSurface);
      expect(doc.keys).toContain(LAGGING_KEY);
      // Restore the fixture for the sibling cases — beforeEach re-commits anyway,
      // but a dirty tree between tests would make a failure here read as a failure
      // there.
      fs.writeFileSync(surfaceBasePath, laggingAnchor);
    },
  );

  it(
    '--update-base on an already-current anchor writes nothing and says nothing to do',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const current = seedSurfaceBase(tip, (k) => k);
      git('add', 'authorable-surface.base.json');
      git('commit', '-q', '-m', 'fixture: anchor already at the merge base');

      const { status, output } = run(['--update-base']);

      expect(status).toBe(0);
      expect(output).toContain('nothing to re-anchor');
      expect(readSurfaceBase()).toBe(current);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    'refuses --check --update-base: a check that repairs what it detects can never report it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const { status, output } = run(['--check', '--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('mutually exclusive');
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(git('status', '--porcelain', '-uno')).toBe('');
      // Refused before the 1600-schema generation, not after it.
      expect(output).not.toContain('Generating JSON Schemas');
    },
  );

  it(
    'never writes the anchor from the build being checked — --update-base is powerless offline',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // #5235's rule survives the new mode: with origin/main unreachable there is
      // no git-resolved baseline, so there is nothing the flag may write FROM. A
      // `--update-base` that fell back to this build's own surface would be the
      // tree anchoring itself — the #4650 defect with a flag in front of it.
      git('update-ref', '-d', 'refs/remotes/origin/main');
      try {
        const { status, output } = run(['--update-base']);

        expect(status).toBe(0);
        expect(output).toContain('origin/main is not resolvable');
        expect(readSurfaceBase()).toBe(laggingAnchor);
        expect(git('status', '--porcelain', '-uno')).toBe('');
      } finally {
        git('update-ref', 'refs/remotes/origin/main', tip);
      }
    },
  );

  it(
    'still refuses to bless an unproven deletion in --update-base mode, and leaves the anchor alone',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Order is load-bearing (see the anchor block in build-schemas.ts): the
      // deletion gate adjudicates first, so the re-anchoring mode cannot be used to
      // walk the baseline past a deletion nothing proved. Without this, #5358's
      // explicit command would be a laundering route the old side effect never was.
      // The sabotage goes in the merge base — the anchor's own keys stay honest, so
      // only the gate, not the authenticity check, can be what fires.
      seedBase((s) => [...s, DELETED_LIVE].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toContain(DELETED_LIVE);
      expect(readSurfaceBase()).toBe(laggingAnchor);
      expect(output).not.toContain('⚓');
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5370 — the anchor moves FORWARD, or it does not move.
//
// #5358 answered WHEN the anchor may be written (only in `--update-base`). It did
// not answer WHERE FROM, and the answer was still "wherever `merge-base(HEAD,
// origin/main)` lands" — which is not always ahead of the anchor already
// committed. The reported shape is a stopped merge: until it is committed, HEAD is
// the branch tip from BEFORE the merge, so the merge base is the branch's OLD fork
// point rather than the main tip being merged in, and re-anchoring there rolls
// `baseRev` BACKWARDS. Measured on the #5312 sync relay: `1c3da1f` → `5aae790`,
// returning the 109 keys #5321 had just retired.
//
// The reason this needs a refusal rather than a warning is that the regressed file
// is INDISTINGUISHABLE from a good one by every property the gates check. The old
// rev is a genuine origin/main ancestor and the keys written are that commit's
// surface verbatim, so `verifyCommittedSurfaceBase`, `check:authorable-surface`
// and the pre-commit os-regen guard are all green before and after. Nothing
// anywhere reports it; the only trace is a reverse `baseRev` move in the diff,
// which reads like #4650's attack shape and was written by the generator.
//
// So both guards are refusals, and each pins its own half here: MERGE_HEAD present
// is refused before a single schema is generated, and any re-anchor whose new rev
// is not a descendant of the committed one is refused at the write.
describe('build-schemas.ts — --update-base moves the anchor forward or not at all (#5370)', () => {
  /** Absent from `older` and from `tip` — the key a backwards move would drop. */
  const FORKED_KEY = 'data/Object:label';
  /** Absent from `older` and from `tip`, present at `mainTip` — so the remedy WRITES. */
  const LANDED_KEY = 'data/Object:description';

  /** The branch's fork point: upstream, and behind the committed anchor. */
  let older: string;
  /** The commit the anchor authentically mirrors — ahead of `older`, on origin/main. */
  let tip: string;
  /** origin/main. Ahead of `tip`, so the anchor is authentic and merely lags. */
  let mainTip: string;
  let anchorAtTip: string;

  const mergeHeadFile = (): string =>
    path.resolve(sandbox, git('rev-parse', '--git-path', 'MERGE_HEAD'));

  beforeAll(() => {
    const keys = pristineSurface;
    for (const k of [FORKED_KEY, LANDED_KEY]) {
      expect(keys, `${k} is no longer in the baseline — pick another live key`).toContain(k);
    }
  });

  beforeEach(() => {
    seedManifest((s) => s);
    // Three upstream commits, linear, each one key richer than the last. The
    // anchor mirrors the MIDDLE one: authentic (its keys ARE that commit's
    // baseline), an ancestor of origin/main, and lagging — the ordinary state of
    // every checkout between two surface changes.
    older = seedBase((s) => s.filter((k) => k !== FORKED_KEY && k !== LANDED_KEY));
    tip = seedBase((s) => s.filter((k) => k !== LANDED_KEY));
    seedBase((s) => s);
    seedSurface((s) => s);
    anchorAtTip = seedSurfaceBase(tip, (k) => k.filter((x) => x !== LANDED_KEY));
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: anchor at the middle upstream commit');
    mainTip = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', mainTip);

    // HEAD forks at `older` and then makes main's own surface change BYTE FOR
    // BYTE. Two consequences, both wanted: `merge-base(HEAD, origin/main)` is
    // `older` (behind the anchor), and merging main in is conflict-free and stages
    // nothing — so `git status` staying empty across a run means the run wrote
    // nothing, with no merge noise to subtract.
    git('checkout', '-q', '-B', 'issue-5370-fork', older);
    seedSurface((s) => s);
    seedSurfaceBase(tip, (k) => k.filter((x) => x !== LANDED_KEY));
    git('add', AUTHORABLE_SURFACE_DIR_NAME, 'authorable-surface.base.json');
    git('commit', '-q', '-m', 'fixture: branch work, forked before the anchor advanced');
    expect(git('status', '--porcelain', '-uno')).toBe('');
    expect(git('merge-base', 'HEAD', mainTip)).toBe(older);
  });

  afterEach(() => {
    if (fs.existsSync(mergeHeadFile())) git('merge', '--abort');
    git('checkout', '-q', '-f', 'main');
    git('update-ref', 'refs/remotes/origin/main', mainTip);
  });

  it(
    'refuses while a merge is uncommitted — before generating anything — and the commit-first remedy works',
    { timeout: SPAWN_TIMEOUT_MS * 3 },
    () => {
      git('merge', '--no-commit', '--no-ff', mainTip);
      expect(fs.existsSync(mergeHeadFile()), 'fixture is not actually mid-merge').toBe(true);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      const refused = run(['--update-base']);

      expect(refused.status).toBe(1);
      expect(refused.output).toContain('refuses to run mid-merge (#5370)');
      expect(refused.output).toContain('Commit the merge first');
      expect(refused.output).toContain('gen:authorable-surface-base');
      // Refused before the ~1600-schema generation, like `--check --update-base`.
      expect(refused.output).not.toContain('Generating JSON Schemas');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      // The guard is narrow: a plain build mid-merge is NOT refused. #5807 took the
      // anchor out of every build, which is why `scripts/regen-artifacts.mjs` can
      // still prescribe `gen:schema` after a merge — refusing that too would break
      // the driver's own deferred regeneration.
      const build = run([]);
      expect(build.status).toBe(0);
      expect(build.output).not.toContain('#5370');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');

      // Now the prescription, literally: commit the merge, then re-anchor. HEAD's
      // merge base with origin/main is `mainTip` once the merge is a commit, so the
      // move is forward and the write lands — the refusal has a working remedy, not
      // just a rule.
      git('commit', '-q', '--no-edit');
      const reanchored = run(['--update-base']);

      expect(reanchored.status).toBe(0);
      expect(reanchored.output).toContain('⚓');
      const doc = JSON.parse(readSurfaceBase()) as { baseRev: string; keys: string[] };
      expect(doc.baseRev).toBe(mainTip);
      expect(doc.keys).toContain(LANDED_KEY);
      expect(doc.keys).toEqual(pristineSurface);
    },
  );

  it(
    'refuses a re-anchor whose new rev is an ancestor of the committed one, and writes nothing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // No merge in sight: the same backwards move reached by ordinary means — a
      // branch forked before the anchor advanced (a `git checkout origin/main --
      // <anchor>` or a driver resolution to THEIRS gets here too). MERGE_HEAD is
      // not the defect, it is one way in; the write is where the defect is decided.
      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('would move authorable-surface.base.json BACKWARDS (#5370)');
      expect(output).toContain(tip.slice(0, 12)); // committed baseRev
      expect(output).toContain(older.slice(0, 12)); // what the run resolved
      expect(output).not.toContain('⚓');
      expect(readSurfaceBase()).toBe(anchorAtTip);
      expect(git('status', '--porcelain', '-uno')).toBe('');
    },
  );

  it(
    'refuses rather than guesses when a NEGATIVE ancestry answer cannot be trusted — a shallow checkout',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Truncating history AT `mainTip` cuts the walk that would reach the anchor's
      // own commit, so `merge-base --is-ancestor tip mainTip` reports "not an
      // ancestor" about a commit that plainly is one — the shape that failed #5358's
      // first CI run, and the live state of every agent container today (the
      // anchor's baseRev sits in `.git/shallow` as its own grafted root).
      //
      // The move here is genuinely FORWARD, so this is the guard's own cost, stated
      // rather than hidden: where the answer is unusable it refuses, and the message
      // has to name the reason and the remedy instead of the backwards verdict. The
      // opposite disposition — trusting the 1 — would fail every re-anchor in a
      // shallow clone with an accusation of a backwards move that never happened.
      fs.writeFileSync(path.join(sandbox, '.git', 'shallow'), `${mainTip}\n`);
      try {
        expect(git('rev-parse', '--is-shallow-repository')).toBe('true');

        const { status, output } = run(['--update-base']);

        expect(status).toBe(1);
        expect(output).toContain('cannot establish which way');
        expect(output).toContain('shallow checkout');
        // The reason it refuses is truncation, NOT a backwards move — a message
        // that said otherwise would send the reader to fix a history that is fine.
        expect(output).not.toContain('BACKWARDS');
        expect(output).toContain('git fetch --unshallow origin');
        expect(output).not.toContain('⚓');
        expect(readSurfaceBase()).toBe(anchorAtTip);
      } finally {
        fs.rmSync(path.join(sandbox, '.git', 'shallow'), { force: true });
      }
    },
  );

  it(
    'an origin/main rewound BEHIND the anchor is caught one gate earlier, by the authenticity check',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Recorded because it is the fixture this guard reads like it needs and does
      // not: pointing origin/main at an ancestor of the committed `baseRev` never
      // reaches the write at all. `verifyCommittedSurfaceBase` runs first and the
      // anchor is no longer an ancestor of origin/main, so the run dies on
      // authenticity — a different fact, with a different remedy. The backwards move
      // the monotonicity guard exists for is the one where BOTH revs are authentic
      // (the case above), which is precisely why nothing else could see it.
      git('update-ref', 'refs/remotes/origin/main', older);

      const { status, output } = run(['--update-base']);

      expect(status).toBe(1);
      expect(output).toContain('NOT an ancestor of');
      expect(output).toContain(tip.slice(0, 12));
      expect(output).not.toContain('#5370');
      expect(readSurfaceBase()).toBe(anchorAtTip);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5371 — the output clean is scoped to THIS generator's artifacts.
//
// `packages/spec/json-schema/` has two writers: this script emits
// `<category>/<Name>.json` and `objectstack.json`, and `gen:openapi`
// (build-openapi.ts) emits `openapi.json`. The clean used to remove the
// DIRECTORY, so it took the sibling's file with it. `pnpm build` never shows
// it (`gen:schema && gen:openapi` rewrites the file last), but every entry
// point that stops after this script leaves the artifact gone — and the tree is
// gitignored with no gate over it (`check:generated` says so itself: "Generated
// but ungated (2): gen:openapi, gen:sbom"), so nothing reports the hole.
//
// It surfaces two packages away instead, as `@objectstack/rest`'s openapi route
// tests failing `expected 503 to be 200` against a diff that never touched
// them. Four independent reports, each one an attribution lap: #5371 itself,
// then mid-#5126, mid-#5588 and mid-#5672.
//
// `--check` gets its own case because it is the reported trigger, not a variant
// of the write path: `check:authorable-surface` IS this script with that flag,
// `check:generated` runs it, and a command whose name says "check" destroying a
// build artifact is precisely what made the cause so hard to reach.
//
// The unit-level behaviour of the clean (nested trees, back-off, an entry it
// cannot remove) is pinned in scripts/json-schema-out-dir.test.ts. What these
// two cases add is the half that file cannot assert: that this script still
// routes its clean through it.
describe('build-schemas.ts — the output clean spares a sibling generator (#5371)', () => {
  const OUT = () => path.join(sandbox, 'json-schema');
  const OPENAPI = 'openapi.json';
  /** Bytes only `gen:openapi` could have written — identity, not just presence. */
  const OPENAPI_BYTES = JSON.stringify(
    { openapi: '3.1.0', 'x-fixture': 'written by gen:openapi, never by gen:schema' },
    null,
    2,
  );
  /** Output of this generator that no current build emits — the clean's own job. */
  const STALE_FILE = 'zzStaleFromAnEarlierRun.json';
  const STALE_DIR = 'zzretiredcategory';

  /** Seed json-schema/ the way a completed `pnpm build` leaves it, plus stale debris. */
  function seedOutDir(): void {
    fs.mkdirSync(path.join(OUT(), STALE_DIR), { recursive: true });
    fs.writeFileSync(path.join(OUT(), STALE_DIR, 'Gone.json'), '{}');
    fs.writeFileSync(path.join(OUT(), STALE_FILE), '{}');
    fs.writeFileSync(path.join(OUT(), OPENAPI), OPENAPI_BYTES);
  }

  /** The clean really ran, over a tree this run really regenerated. */
  function expectCleanedAndRegenerated(): void {
    expect(fs.existsSync(path.join(OUT(), STALE_FILE))).toBe(false);
    expect(fs.existsSync(path.join(OUT(), STALE_DIR))).toBe(false);
    expect(fs.existsSync(path.join(OUT(), 'objectstack.json'))).toBe(true);
    expect(fs.existsSync(path.join(OUT(), 'data', 'Object.json'))).toBe(true);
  }

  beforeEach(() => {
    // A current, self-consistent tree, so the run exits 0 and the assertions
    // below are about the clean rather than about some ratchet upstream of it.
    seedManifest((s) => s);
    const tip = seedBase((s) => s);
    seedSurface((s) => s);
    seedSurfaceBase(tip, (k) => k);
  });

  it(
    "leaves gen:openapi's artifact byte-identical while still sweeping its own stale output",
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedOutDir();

      const { status, output } = run([]);

      expect(status).toBe(0);
      // "No stale files remain" is unchanged — this is not a narrower clean.
      expectCleanedAndRegenerated();
      // …and the sibling's artifact is neither deleted nor rewritten.
      expect(fs.readFileSync(path.join(OUT(), OPENAPI), 'utf8')).toBe(OPENAPI_BYTES);
      // Announced, so an exemption is never indistinguishable from a miss.
      expect(output).toContain(`kept ${OPENAPI}`);
      expect(output).toContain('gen:openapi');
    },
  );

  it(
    '--check does the same — the reported trigger was a command named check: (#5371)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedOutDir();

      const { status } = run(['--check']);

      expect(status).toBe(0);
      // `--check` still rebuilds the gitignored tree it computes from (that is
      // #4711's boundary: it may not write a TRACKED file), so the clean runs
      // here too — which is exactly why this path could delete the artifact.
      expectCleanedAndRegenerated();
      expect(fs.readFileSync(path.join(OUT(), OPENAPI), 'utf8')).toBe(OPENAPI_BYTES);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #4659 — check (b) registers a tombstone by its EXACT key, not by its leaf.
//
// Until this change, "live → retired must be registered" was satisfied by
// matching the key's LEAF against every ' / '-separated conversion/migration
// `surface` in the ADR-0087 registries — `endsWith('.' + name)`, across all
// majors, ignoring which def the key belonged to. So any unrelated registration
// ending in the same leaf registered a tombstone for free. #4658 measured it:
// tombstoning `automation/Event:type` passed silently because protocol 11's
// `flow-node-http-callout-rename` had registered `flow.node.type`. #5509 widened
// the leaf vocabulary to `.description`, one of the most common keys on
// authorable shapes, and the exposure grew with every conversion.
//
// The registration now lives in its own table — RETIRED_KEYS_BY_MAJOR in
// src/migrations/registry.ts, values the literal `${defKey}:${name}` — and
// check (b) is exact set membership over it. Conversion `surface` prose is
// untouched: it addresses authors in the shape they write metadata
// (`flow.nodes[].outputSchema`) and no rule can map that back onto a def key.
//
// ── Why a SECOND sandbox ──────────────────────────────────────────────────
// These tests need the gate to read a registry that differs per case, and the
// sandbox above symlinks `src/`, so writing one there would write the repo's
// tracked registry. This one COPIES `src/` instead (10 MB, ~40 ms) so its
// `src/migrations/registry.ts` is a fixture. Nothing else changes: the gate
// under test is the same copied `scripts/build-schemas.ts`, reading a byte-equal
// spec source, and no test-only seam is added to it — the substituted table is
// fixture data exactly as the fabricated `refs/remotes/origin/main` is.
//
// ── Why the green cases still exit 1 ──────────────────────────────────────
// A live → retired transition exists only when the committed baseline disagrees
// with the emitted contract, so every fixture here is, by construction, a
// baseline the generated-form reporter at the end of the script will call stale.
// That reporter is a different failure with a different remedy, and the
// assertions below discriminate on the message, never on the exit code alone.

/** Retired keys whose ONLY registered clause names a DIFFERENT def — the defect. */
const LEAF_COLLIDER_A = 'api/HttpFindQueryParams:distinct';
/** …matched by this clause, which registers `data/Query`'s key, not this one. */
const LEAF_COLLIDER_A_CLAUSE = 'data.query.distinct';
/** The issue's own `.type` shape: an index type dated by a flow node rename. */
const LEAF_COLLIDER_B = 'data/Index:type';
/** …registered at protocol 11 by `flow-node-http-callout-rename`. Unrelated. */
const LEAF_COLLIDER_B_CLAUSE = 'flow.node.type';
/** A key no author has ever been able to lose — the (b2) "still LIVE" fixture. */
const STILL_LIVE_KEY = 'data/Object:name';
/** A key no build emits: the aged-out steady state a stale entry decays into. */
const AGED_OUT_KEY = 'data/Object:zzAgedOutTombstone4659';

/**
 * The pre-#4659 matcher, reproduced ONLY to prove the fixtures still model the
 * defect: every registered clause whose leaf would have registered `key`. If
 * this ever returns nothing for a fixture, the fixture stopped being a
 * collision and the test below asserts something weaker than it claims.
 */
function clausesMatchingLeafOf(key: string): string[] {
  const leaf = key.slice(key.indexOf(':') + 1);
  const out: string[] = [];
  const consider = (surface: string): void => {
    for (const clause of surface.split(' / ')) if (clause.endsWith('.' + leaf)) out.push(clause);
  };
  for (const list of Object.values(CONVERSIONS_BY_MAJOR)) for (const c of list) consider(c.surface);
  for (const step of Object.values(MIGRATIONS_BY_MAJOR)) {
    for (const sem of step.semantic ?? []) consider(sem.surface);
  }
  return out;
}

describe('build-schemas.ts — check (b) matches the exact retired key, not its leaf (#4659)', () => {
  let box: string;
  let boxScript: string;
  let boxSurfaceDir: string;
  let boxRegistry: string;
  let pristineRegistry: string;

  const boxGit = (...args: string[]): string => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=build-schemas-test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: box, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
    return (r.stdout ?? '').trim();
  };

  const runBox = (args: string[] = []): { status: number; output: string } => {
    const r = spawnSync(TSX, [boxScript, ...args], {
      cwd: box,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  /** Untombstone keys in the sandbox baseline: the gate then sees live → retired. */
  const untombstone = (...keys: string[]): void => {
    writeSurfaceShards(
      boxSurfaceDir,
      pristineSurface.map((e) => (keys.includes(e.replace(RETIRED_MARK, '')) ? e.replace(RETIRED_MARK, '') : e)),
    );
  };

  /** Substitute RETIRED_KEYS_BY_MAJOR in the sandbox's own copy of the registry. */
  const seedRetiredKeys = (table: Record<number, readonly string[]>): void => {
    const rendered =
      `export const RETIRED_KEYS_BY_MAJOR: Readonly<Record<number, readonly string[]>> = {\n` +
      Object.keys(table)
        .map(Number)
        .sort((a, b) => a - b)
        .map((m) => `  ${m}: [\n${table[m]!.map((k) => `    '${k}',\n`).join('')}  ],\n`)
        .join('') +
      `};\n`;
    const anchor = /export const RETIRED_KEYS_BY_MAJOR[\s\S]*?\n\};\n/;
    expect(
      anchor.test(pristineRegistry),
      'RETIRED_KEYS_BY_MAJOR is no longer a single object literal in src/migrations/registry.ts — ' +
        'this fixture substitutes it textually and can no longer find it',
    ).toBe(true);
    fs.writeFileSync(boxRegistry, pristineRegistry.replace(anchor, rendered));
  };

  const CHECK_B = 'key(s) were tombstoned with no registered retirement';

  beforeAll(() => {
    // Fixture validity, loud: both keys must still be leaf-collisions (they are
    // the defect), and neither may be registered in the real table (they are
    // NOT retirements this repo made under the new gate).
    expect(clausesMatchingLeafOf(LEAF_COLLIDER_A)).toContain(LEAF_COLLIDER_A_CLAUSE);
    expect(clausesMatchingLeafOf(LEAF_COLLIDER_B)).toContain(LEAF_COLLIDER_B_CLAUSE);
    const declared = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    for (const k of [LEAF_COLLIDER_A, LEAF_COLLIDER_B]) {
      expect(declared, `${k} is now registered for real — pick an unregistered fixture`).not.toContain(k);
    }
    const baselineKeys = pristineSurface;
    for (const k of [LEAF_COLLIDER_A, LEAF_COLLIDER_B]) {
      expect(baselineKeys, `${k} is no longer tombstoned — re-pick`).toContain(k + RETIRED_MARK);
    }
    expect(baselineKeys, `${STILL_LIVE_KEY} is no longer a live authorable key`).toContain(STILL_LIVE_KEY);
    expect(baselineKeys.some((k) => k.startsWith(AGED_OUT_KEY))).toBe(false);

    box = fs.mkdtempSync(path.join(os.tmpdir(), 'build-schemas-retired-keys-'));
    fs.cpSync(path.join(PKG, 'scripts'), path.join(box, 'scripts'), { recursive: true });
    fs.cpSync(path.join(PKG, 'src'), path.join(box, 'src'), { recursive: true });
    for (const entry of ['node_modules', 'package.json']) {
      fs.symlinkSync(path.join(PKG, entry), path.join(box, entry));
    }
    writeManifestShards(path.join(box, SCHEMA_MANIFEST_DIR_NAME), pristine);
    boxSurfaceDir = path.join(box, AUTHORABLE_SURFACE_DIR_NAME);
    writeSurfaceShards(boxSurfaceDir, pristineSurface);
    boxScript = path.join(box, 'scripts', 'build-schemas.ts');
    boxRegistry = path.join(box, 'src', 'migrations', 'registry.ts');
    pristineRegistry = fs.readFileSync(boxRegistry, 'utf8');

    boxGit('init', '-q', '-b', 'main', '.');
    boxGit('add', AUTHORABLE_SURFACE_DIR_NAME);
    boxGit('commit', '-q', '-m', `baseline: committed ${AUTHORABLE_SURFACE_DIR_NAME}/`);
    fs.writeFileSync(
      path.join(box, 'authorable-surface.base.json'),
      JSON.stringify(
        {
          description: surfaceBaseDescription,
          baseRev: boxGit('rev-parse', 'HEAD'),
          keys: pristineSurface,
        },
        null,
        2,
      ) + '\n',
    );
    boxGit('add', 'authorable-surface.base.json');
    boxGit('commit', '-q', '-m', 'baseline anchor');
    boxGit('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  afterAll(() => {
    if (box) fs.rmSync(box, { recursive: true, force: true });
  });

  it(
    'a tombstone whose leaf collides with an unrelated registered surface is NOT registered (#4658)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The repro, in the shape #4658 recorded it: two keys tombstoned, no entry
      // written for either, and both leaves already spoken for by conversions
      // belonging to other defs. Before this change the gate said nothing at all
      // about them and the run fell through to the staleness reporter.
      seedRetiredKeys({});
      untombstone(LEAF_COLLIDER_A, LEAF_COLLIDER_B);

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`2 ${CHECK_B}`);
      expect(output).toContain(`     - ${LEAF_COLLIDER_A}`);
      expect(output).toContain(`     - ${LEAF_COLLIDER_B}`);
      // The prescription IS the contract: the exact line to paste, and where.
      expect(output).toContain(`        '${LEAF_COLLIDER_A}',`);
      expect(output).toContain(`        '${LEAF_COLLIDER_B}',`);
      expect(output).toContain('RETIRED_KEYS_BY_MAJOR');
      expect(output).toContain(`under \`${CURRENT_MAJOR}: [ … ]\``);
      // The D2 conversion is still asked for — the table did not replace it.
      expect(output).toContain('src/conversions/registry.ts');
    },
  );

  it(
    'registering one key registers exactly that key — its neighbour with the same leaf still fails',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // `data.query.distinct` covered A only by leaf; now even a REAL entry for
      // B cannot cover A. This is the whole change in one run: membership is per
      // key, and nothing radiates from one registration to another.
      seedRetiredKeys({ [CURRENT_MAJOR]: [LEAF_COLLIDER_B] });
      untombstone(LEAF_COLLIDER_A, LEAF_COLLIDER_B);

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${CHECK_B}`);
      expect(output).toContain(`     - ${LEAF_COLLIDER_A}`);
      expect(output).not.toContain(`     - ${LEAF_COLLIDER_B}`);
    },
  );

  it(
    'both keys registered by exact name: check (b) is silent (the run then only owes the regenerated baseline)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedRetiredKeys({ [CURRENT_MAJOR]: [LEAF_COLLIDER_A, LEAF_COLLIDER_B] });
      untombstone(LEAF_COLLIDER_A, LEAF_COLLIDER_B);

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(CHECK_B);
      expect(output).not.toContain('still LIVE');
      expect(output).not.toContain('deleted without proof');
      // Intrinsic to the fixture, not a residue of the gate: a live → retired
      // transition IS a baseline that has not been regenerated yet, so the run
      // still owes `gen:schema`. Asserted rather than papered over.
      expect(status).toBe(1);
      expect(output).toContain('authorable-surface/ is out of date (2 key(s) not recorded)');
      expect(output).toContain(`+ ${LEAF_COLLIDER_A}${RETIRED_MARK}`);
    },
  );

  it(
    'an entry naming a key that is still LIVE fails: a registration nothing consumed (b2)',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The mirror defect. Without this, an author could pre-register the key
      // they intend to retire, and the tombstone would then land — months later,
      // in someone else's PR — with check (b) already satisfied and nobody
      // writing anything down.
      seedRetiredKeys({ [CURRENT_MAJOR]: [STILL_LIVE_KEY] });
      untombstone(); // baseline pristine: nothing is newly retired

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('RETIRED_KEYS_BY_MAJOR entr(ies) name a key that is still LIVE');
      expect(output).toContain(`     - ${STILL_LIVE_KEY}  (registered at major ${CURRENT_MAJOR})`);
      expect(output).toContain('retiredKey(');
      expect(output).not.toContain(CHECK_B);
    },
  );

  it(
    'an entry naming a key this build no longer emits is the aged-out steady state, not an error',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // A tombstone ages out after TOMBSTONE_AGE_MAJORS and check (c) lets its
      // baseline line go; the entry here stays and then names nothing. Pinned
      // because the opposite ruling — "an entry must always resolve" — would
      // force every aged-out retirement to be un-declared to keep the gate
      // green, which is the record deleting itself.
      seedRetiredKeys({ 11: [AGED_OUT_KEY] });
      untombstone();

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain('still LIVE');
      expect(output).not.toContain(CHECK_B);
      expect(output).not.toContain('deleted without proof');
      expect(status).toBe(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #4725 — a deleted json-schema.manifest.json key must prove itself too.
//
// #4650 closed the hand-edit shortcut for authorable KEYS and left whole-DEF
// removals to the #2978 manifest ratchet — check (c) route 3 says so verbatim:
// "whole-schema removals are adjudicated by json-schema.manifest.json". They
// were not. That ratchet's `missing` set is `manifest − emitted` with the
// manifest read from the SAME commit, so a PR deleting the export, the manifest
// line and the baseline lines together produced an empty `missing`, a check (c)
// that waived every key under the now-gone def, and an `api-surface` diff a
// regeneration turns green. Three gates, nothing said — the same shape #4650
// closed one level down, with the two gates deferring to each other.
//
// Measured before the fix, by deleting ONE barrel line (`export * from
// './validation.zod'` in src/data/index.ts, whose defs ObjectSchema imports
// DIRECTLY and so keeps parsing `object` metadata with): 7 defs and 116
// authorable keys left the published contract, `gen:schema` and
// `check:authorable-surface` both exiting 0. The last case in this block is that
// repro, run for real against the copied `src/`.
//
// ── Why declaration, and not reachability ─────────────────────────────────
// The issue proposed reusing the #4650 BFS ("the def is unreachable from the
// metadata roots"). It cannot be reused in this direction, and the failure is
// silent: `reachableVia()` looks the def up in `zodByDefKey`, which is populated
// only for defs the build EMITS, so a def that just stopped being emitted
// answers `null` — "unreachable", i.e. waived — for exactly the removals the
// gate exists to catch. Widening the BFS cannot fix that: the def is gone from
// the source, so there is no schema left to walk. The proof is therefore a
// DECLARATION, RETIRED_DEFS_BY_MAJOR, following #4659's exact-key precedent one
// level up. The `zzOverCollectedFamily` fixture below is deliberately a def the
// build never emitted, so it would answer "unreachable" too — a gate that
// consulted reachability would let it through, and this block would be green.
//
// ── Why a THIRD sandbox ───────────────────────────────────────────────────
// Two reasons, both structural. The gate reads the manifest AT THE MERGE BASE,
// so `json-schema.manifest.json` has to be a TRACKED file whose committed
// content differs from the worktree's — the first sandbox commits only the
// authorable surface, and tracking the manifest there would make every
// `seedManifest()` dirty the tree that the #5358 block asserts is clean. And the
// registry table has to differ per case, which needs a copied `src/` (the first
// sandbox symlinks it). Same discipline as the #4659 box: production code path
// byte-for-byte, fixture data only.

/** Planted in the BASE manifest, emitted by no build: a def that "left". */
const REMOVED_DEF = 'ui/ZzzOverCollectedFamily4725';
/** A second one, so the prescription is pinned in the plural. */
const REMOVED_DEF_2 = 'ui/ZzzOverCollectedFamily4725Sibling';
/** A def every build publishes — the mirror's fixture. */
const STILL_PUBLISHED_DEF = 'ui/View';
/** The barrel line whose removal unpublishes a REACHABLE def family. */
const BARREL_LINE = "export * from './validation.zod';\n";
/** The defs that line publishes; `ObjectSchema` imports them directly, so every
 *  one of them stays reachable from the `object` metadata root after it goes. */
const UNPUBLISHED_FAMILY = [
  'data/ConditionalValidation',
  'data/CrossFieldValidation',
  'data/FormatValidation',
  'data/JSONValidation',
  'data/ScriptValidation',
  'data/StateMachineValidation',
  'data/ValidationRule',
];

describe('build-schemas.ts — a deleted manifest key must prove itself (#4725)', () => {
  let box: string;
  let boxScript: string;
  let boxManifestDir: string;
  let boxSurfaceDir: string;
  let boxRegistry: string;
  let boxBarrel: string;
  let pristineRegistry: string;
  let pristineBarrel: string;
  let head: string;

  const boxGit = (...args: string[]): string => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=build-schemas-test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: box, encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
    return (r.stdout ?? '').trim();
  };

  const runBox = (args: string[] = []): { status: number; output: string } => {
    const r = spawnSync(TSX, [boxScript, ...args], {
      cwd: box,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  /** Write the box's worktree manifest shards from the committed set. */
  const writeManifest = (mutate: (schemas: string[]) => string[]): void => {
    writeManifestShards(boxManifestDir, mutate([...pristine]));
  };

  /**
   * Commit a BASE variant of the manifest and point origin/main at it, then
   * restore the worktree manifest to the canonical one. Set-wise identical to
   * the real removal — a key present at the merge base and absent from what this
   * build emits — without needing the source that emitted it.
   */
  const seedBaseManifest = (mutate: (schemas: string[]) => string[]): void => {
    writeManifest(mutate);
    boxGit('add', SCHEMA_MANIFEST_DIR_NAME);
    boxGit('commit', '-q', '--allow-empty', '-m', 'base manifest variant');
    head = boxGit('rev-parse', 'HEAD');
    boxGit('update-ref', 'refs/remotes/origin/main', head);
    writeManifest((s) => s);
  };

  /** Substitute RETIRED_DEFS_BY_MAJOR in the box's own copy of the registry. */
  const seedRetiredDefs = (table: Record<number, readonly string[]>): void => {
    const rendered =
      `export const RETIRED_DEFS_BY_MAJOR: Readonly<Record<number, readonly string[]>> = {\n` +
      Object.keys(table)
        .map(Number)
        .sort((a, b) => a - b)
        .map((m) => `  ${m}: [\n${table[m]!.map((k) => `    '${k}',\n`).join('')}  ],\n`)
        .join('') +
      `};\n`;
    const anchor = /export const RETIRED_DEFS_BY_MAJOR[\s\S]*?\n\};\n/;
    expect(
      anchor.test(pristineRegistry),
      'RETIRED_DEFS_BY_MAJOR is no longer a single object literal in src/migrations/registry.ts — ' +
        'this fixture substitutes it textually and can no longer find it',
    ).toBe(true);
    fs.writeFileSync(boxRegistry, pristineRegistry.replace(anchor, rendered));
  };

  const NO_REGISTERED_REMOVAL = 'schema(s) left the published set with no registered removal (#4725)';

  beforeAll(() => {
    // Fixture validity, loud rather than silently stale.
    const manifestKeys = pristine;
    for (const def of [REMOVED_DEF, REMOVED_DEF_2]) {
      expect(manifestKeys, `${def} is a real published def — pick a phantom`).not.toContain(def);
    }
    expect(manifestKeys, `${STILL_PUBLISHED_DEF} is no longer published — pick another`).toContain(
      STILL_PUBLISHED_DEF,
    );
    for (const def of UNPUBLISHED_FAMILY) {
      expect(manifestKeys, `${def} is no longer published — the end-to-end repro needs a new family`).toContain(def);
    }
    const declared = Object.values(RETIRED_DEFS_BY_MAJOR).flat();
    for (const def of [REMOVED_DEF, REMOVED_DEF_2, STILL_PUBLISHED_DEF, ...UNPUBLISHED_FAMILY]) {
      expect(declared, `${def} is now registered for real — pick an unregistered fixture`).not.toContain(def);
    }

    box = fs.mkdtempSync(path.join(os.tmpdir(), 'build-schemas-manifest-removal-'));
    fs.cpSync(path.join(PKG, 'scripts'), path.join(box, 'scripts'), { recursive: true });
    fs.cpSync(path.join(PKG, 'src'), path.join(box, 'src'), { recursive: true });
    for (const entry of ['node_modules', 'package.json']) {
      fs.symlinkSync(path.join(PKG, entry), path.join(box, entry));
    }
    boxScript = path.join(box, 'scripts', 'build-schemas.ts');
    boxManifestDir = path.join(box, SCHEMA_MANIFEST_DIR_NAME);
    boxSurfaceDir = path.join(box, AUTHORABLE_SURFACE_DIR_NAME);
    boxRegistry = path.join(box, 'src', 'migrations', 'registry.ts');
    boxBarrel = path.join(box, 'src', 'data', 'index.ts');
    pristineRegistry = fs.readFileSync(boxRegistry, 'utf8');
    pristineBarrel = fs.readFileSync(boxBarrel, 'utf8');
    expect(
      pristineBarrel.includes(BARREL_LINE),
      'src/data/index.ts no longer re-exports ./validation.zod — the end-to-end repro needs a new family',
    ).toBe(true);

    writeManifestShards(boxManifestDir, pristine);
    writeSurfaceShards(boxSurfaceDir, pristineSurface);
    boxGit('init', '-q', '-b', 'main', '.');
    // BOTH artifacts tracked here: the merge-base manifest is what this gate
    // reads, and the surface baseline keeps the #4650 gate honest alongside it.
    boxGit('add', SCHEMA_MANIFEST_DIR_NAME, AUTHORABLE_SURFACE_DIR_NAME);
    boxGit('commit', '-q', '-m', 'baseline: committed manifest + authorable surface');
    fs.writeFileSync(
      path.join(box, 'authorable-surface.base.json'),
      JSON.stringify(
        {
          description: surfaceBaseDescription,
          baseRev: boxGit('rev-parse', 'HEAD'),
          keys: pristineSurface,
        },
        null,
        2,
      ) + '\n',
    );
    boxGit('add', 'authorable-surface.base.json');
    boxGit('commit', '-q', '-m', 'baseline anchor');
    head = boxGit('rev-parse', 'HEAD');
    boxGit('update-ref', 'refs/remotes/origin/main', head);
  });

  beforeEach(() => {
    // A clean, current base every time — including the merge-base MANIFEST,
    // which each fixture below mutates and which would otherwise leak the
    // previous case's planted removal into the next one's count.
    seedRetiredDefs({});
    writeSurfaceShards(boxSurfaceDir, pristineSurface);
    fs.writeFileSync(boxBarrel, pristineBarrel);
    seedBaseManifest((s) => s);
  });

  afterAll(() => {
    if (box) fs.rmSync(box, { recursive: true, force: true });
  });

  it(
    'is silent when nothing left the published set — the new failure is the removal, not the gate',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Negative control. Without it, "always red" would satisfy every assertion
      // below while breaking `check:authorable-surface` for everyone.
      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(NO_REGISTERED_REMOVAL);
      expect(output).not.toContain('left the published set since');
      expect(status).toBe(0);
    },
  );

  it(
    'the bypass repro: a def gone from the build AND from the manifest is red, naming it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The #4725 shape, set-wise: two defs present in the manifest at the merge
      // base, emitted by no build, and absent from the manifest this commit
      // carries. Before the fix `missing` was empty and every gate exited 0.
      seedBaseManifest((s) => [...s, REMOVED_DEF, REMOVED_DEF_2].sort());

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`2 ${NO_REGISTERED_REMOVAL}`);
      expect(output).toContain(`     - json-schema/${REMOVED_DEF}.json`);
      expect(output).toContain(`     - json-schema/${REMOVED_DEF_2}.json`);
      // The prescription IS the contract: the exact lines to paste, and where.
      expect(output).toContain(`        '${REMOVED_DEF}',`);
      expect(output).toContain(`        '${REMOVED_DEF_2}',`);
      expect(output).toContain('RETIRED_DEFS_BY_MAJOR');
      expect(output).toContain(`under \`${CURRENT_MAJOR}: [ … ]\``);
      // …and the two other routes a reader might actually need are named.
      expect(output).toContain('RENAMED_DEFS');
      expect(output).toContain('src/conversions/registry.ts');
      // Anchored on the merge base, which is the half a hand-edit cannot reach.
      expect(output).toContain(`merge base ${head.slice(0, 12)}`);
    },
  );

  it(
    'write mode refuses identically — regenerating cannot bless a removal either',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBaseManifest((s) => [...s, REMOVED_DEF].sort());
      const before = shardBytes(boxManifestDir);

      const { status, output } = runBox([]);

      expect(status).toBe(1);
      expect(output).toContain(NO_REGISTERED_REMOVAL);
      expect(output).toContain(REMOVED_DEF);
      expect(shardBytes(boxManifestDir)).toBe(before);
    },
  );

  it(
    'a declared removal passes, and the run says which major declared it',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBaseManifest((s) => [...s, REMOVED_DEF].sort());
      seedRetiredDefs({ [CURRENT_MAJOR]: [REMOVED_DEF] });

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(NO_REGISTERED_REMOVAL);
      expect(output).toContain('1 schema(s) left the published set since');
      expect(output).toContain(`json-schema/${REMOVED_DEF}.json — RETIRED_DEFS_BY_MAJOR, major ${CURRENT_MAJOR}`);
      expect(status).toBe(0);
    },
  );

  it(
    'registration is per DEF: declaring one does not cover its sibling',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The #4659 lesson, inherited rather than re-learned: nothing radiates
      // from one entry to another, and no name is matched by prefix or leaf.
      seedBaseManifest((s) => [...s, REMOVED_DEF, REMOVED_DEF_2].sort());
      seedRetiredDefs({ [CURRENT_MAJOR]: [REMOVED_DEF] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${NO_REGISTERED_REMOVAL}`);
      expect(output).toContain(`     - json-schema/${REMOVED_DEF_2}.json`);
      // The declared one appears only in the ℹ️ notice, never in the fatal list.
      // Matched with its trailing newline, because the notice's line opens with
      // the same path and then goes on to name the major.
      expect(output).toContain(
        `json-schema/${REMOVED_DEF}.json — RETIRED_DEFS_BY_MAJOR, major ${CURRENT_MAJOR}`,
      );
      expect(output).not.toContain(`     - json-schema/${REMOVED_DEF}.json\n`);
    },
  );

  it(
    'an entry naming a schema this build still publishes is red: a registration nothing consumed',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The mirror of check (b2), one level up. Without it an author could
      // pre-register the def they intend to unpublish, and the real removal
      // would land later — in someone else's PR — with this gate already
      // satisfied and nobody writing anything down at the time it happened.
      seedRetiredDefs({ [CURRENT_MAJOR]: [STILL_PUBLISHED_DEF] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('RETIRED_DEFS_BY_MAJOR entr(ies) name a schema this build still publishes');
      expect(output).toContain(`     - ${STILL_PUBLISHED_DEF}  (registered at major ${CURRENT_MAJOR})`);
      expect(output).not.toContain(NO_REGISTERED_REMOVAL);
    },
  );

  it(
    'a declared def rename is not a removal — RENAMED_DEFS is consulted before the table',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      const [renamedSource] = Object.keys(RENAMED_DEFS);
      expect(renamedSource, 'RENAMED_DEFS is empty — this test exercises nothing').toBeTruthy();
      // The source def is gone from the build by construction (checkRenameTable
      // rejects a table whose source is still emitted), so at the merge base it
      // is a manifest key this build does not emit — a removal in every respect
      // except the one that matters.
      seedBaseManifest((s) => [...s, renamedSource!].sort());

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(NO_REGISTERED_REMOVAL);
      expect(output).not.toContain('left the published set since');
      expect(status).toBe(0);
    },
  );

  it(
    'offline: the comparison says so and skips, while the registration mirror still runs',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      // #5235's posture, not a third one. The comparison has no baseline with
      // origin/main out of reach, so it reports that and skips — those trees are
      // immutable, already-merged builds (image stages, air-gapped, forks,
      // historical tags) where "what did this PR delete relative to main" is not
      // a question that exists. The mirror needs no git and therefore keeps
      // running: an entry that pre-approves a removal is wrong everywhere.
      seedBaseManifest((s) => [...s, REMOVED_DEF].sort());
      boxGit('update-ref', '-d', 'refs/remotes/origin/main');
      try {
        const skipped = runBox(['--check']);
        expect(skipped.status).toBe(0);
        expect(skipped.output).toContain('json-schema.manifest/ removal check');
        expect(skipped.output).toContain('no git-resolved baseline');
        expect(skipped.output).not.toContain(NO_REGISTERED_REMOVAL);

        seedRetiredDefs({ [CURRENT_MAJOR]: [STILL_PUBLISHED_DEF] });
        const mirrored = runBox(['--check']);
        expect(mirrored.status).toBe(1);
        expect(mirrored.output).toContain('name a schema this build still publishes');
      } finally {
        boxGit('update-ref', 'refs/remotes/origin/main', head);
      }
    },
  );

  it(
    'end to end: unpublishing a REACHABLE def family is red, where every gate used to be green',
    { timeout: SPAWN_TIMEOUT_MS * 2 },
    () => {
      // The measured repro, run against real source rather than modelled. The
      // barrel line goes; `ObjectSchema` still imports ValidationRuleSchema from
      // './validation.zod', so all 7 defs stay reachable from the `object`
      // metadata root and every one of their 116 keys stays authorable — only
      // their JSON Schemas, their manifest lines and the ratchet's record of
      // them disappear. Then the two hand-edits the old procedure sanctioned:
      // delete the manifest lines ("a deliberate retirement") and the baseline
      // lines (without which check (a) fires first).
      fs.writeFileSync(boxBarrel, pristineBarrel.replace(BARREL_LINE, ''));
      writeManifest((s) => s.filter((k) => !UNPUBLISHED_FAMILY.includes(k)));
      const kept = pristineSurface.filter(
        (k) => !UNPUBLISHED_FAMILY.some((d) => k.startsWith(d + ':')),
      );
      expect(
        pristineSurface.length - kept.length,
        'the family stopped carrying authorable keys — re-measure the repro',
      ).toBeGreaterThan(0);
      writeSurfaceShards(boxSurfaceDir, kept);

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`${UNPUBLISHED_FAMILY.length} ${NO_REGISTERED_REMOVAL}`);
      for (const def of UNPUBLISHED_FAMILY) {
        expect(output).toContain(`     - json-schema/${def}.json`);
        expect(output).toContain(`        '${def}',`);
      }
      // The old verdict, in full: check (c) waived all 116 lines as "def no
      // longer emitted", the manifest ratchet said nothing, and the run exited
      // 0. The gate now exits before check (c) reaches that branch at all.
      expect(output).not.toContain('carry their own proof');
      expect(output).not.toContain('baseline deletion(s) since');
    },
  );
});
