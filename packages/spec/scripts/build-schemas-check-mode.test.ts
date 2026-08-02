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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RENAMED_DEFS } from './lib/renamed-defs';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR } from '../src/migrations/registry';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const TSX = path.join(PKG, 'node_modules', '.bin', 'tsx');
const REAL_MANIFEST = path.join(PKG, 'json-schema.manifest.json');

/**
 * Every run loads the entire spec surface and emits ~1700 JSON Schemas (~7s
 * alone, more under turbo's parallel test load). A timeout here should mean
 * "the script hung", not "the runner was busy" — cf. the same note in
 * check-react-blocks-declaration-parity.test.ts.
 */
const SPAWN_TIMEOUT_MS = 180_000;

/** A schema key the committed manifest carries; dropping it fakes "one addition pending". */
const KNOWN_KEY = 'ui/View';
/** A key no build can emit — the `missing` (disappearance) ratchet's input. */
const PHANTOM_KEY = 'ui/ZzzNeverEmittedByAnyBuild';

let sandbox: string;
let script: string;
let manifestPath: string;
let surfacePath: string;
let pristine: string;
let pristineSurface: string;

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

beforeAll(() => {
  pristine = fs.readFileSync(REAL_MANIFEST, 'utf8');
  pristineSurface = fs.readFileSync(path.join(PKG, 'authorable-surface.json'), 'utf8');
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'build-schemas-check-'));
  fs.cpSync(path.join(PKG, 'scripts'), path.join(sandbox, 'scripts'), { recursive: true });
  for (const entry of ['src', 'node_modules', 'package.json']) {
    fs.symlinkSync(path.join(PKG, entry), path.join(sandbox, entry));
  }
  // The authorable-surface ratchet runs after the manifest one; give it the
  // committed snapshot so a check that gets that far judges the same contract.
  fs.copyFileSync(
    path.join(PKG, 'authorable-surface.json'),
    path.join(sandbox, 'authorable-surface.json'),
  );
  script = path.join(sandbox, 'scripts', 'build-schemas.ts');
  manifestPath = path.join(sandbox, 'json-schema.manifest.json');
  surfacePath = path.join(sandbox, 'authorable-surface.json');
  // Anchor for the #4650 deletion check: a git repo whose origin/main holds the
  // committed baseline. Only the baseline is tracked — src/node_modules stay
  // symlinked, untracked reads the same as any dirty worktree.
  git('init', '-q', '-b', 'main', '.');
  git('add', 'authorable-surface.json');
  git('commit', '-q', '-m', 'baseline: committed authorable-surface.json');
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

/** Seed the sandbox manifest from the committed one; returns the exact bytes written. */
function seedManifest(mutate: (schemas: string[]) => string[]): string {
  const doc = JSON.parse(pristine) as { description?: string; schemas: string[] };
  doc.schemas = mutate(doc.schemas);
  const text = JSON.stringify(doc, null, 2) + '\n';
  fs.writeFileSync(manifestPath, text);
  return text;
}

const readManifest = () => fs.readFileSync(manifestPath, 'utf8');

describe('build-schemas.ts --check — a check reports, it does not write (#4711)', () => {
  it(
    'fails on a manifest behind on additions, and leaves the file byte-identical',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(JSON.parse(pristine).schemas).toContain(KNOWN_KEY);
      const stale = seedManifest((s) => s.filter((k) => k !== KNOWN_KEY));

      const { status, output } = run(['--check']);

      // The exit code is half the fix: before #4711 this branch exited 0.
      expect(status).toBe(1);
      expect(output).toMatch(/json-schema\.manifest\.json is out of date \(1 schema\(s\) not recorded\)/);
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
        /json-schema\.manifest\.json is out of date .*1 renamed-away key\(s\) still listed/,
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
      expect(output).toContain('📒 json-schema.manifest.json updated (+1 schema(s))');
      expect(readManifest()).not.toBe(stale);
      expect(JSON.parse(readManifest()).schemas).toContain(KNOWN_KEY);
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

      expect(output).not.toMatch(/json-schema\.manifest\.json is out of date/);
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

const readSurface = () => fs.readFileSync(surfacePath, 'utf8');

/** Write a mutated baseline to the sandbox worktree; returns the exact bytes. */
function seedSurface(mutate: (keys: string[]) => string[]): string {
  const doc = JSON.parse(pristineSurface) as { description: string; keys: string[] };
  doc.keys = mutate(doc.keys);
  const text = JSON.stringify(doc, null, 2) + '\n';
  fs.writeFileSync(surfacePath, text);
  return text;
}

/** Commit a BASE variant of the baseline and point origin/main at it. */
function seedBase(mutate: (keys: string[]) => string[]): string {
  seedSurface(mutate);
  git('add', 'authorable-surface.json');
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
/** Base key under a def RENAMED_DEFS moved: carried, so never a deletion. */
const DELETED_BY_RENAME = 'integration/RateLimitConfig:maxRequests';

describe('build-schemas.ts — deleted baseline lines must prove themselves (#4650)', () => {
  beforeAll(() => {
    // Fixture validity, asserted loudly instead of silently going stale.
    const keys = (JSON.parse(pristineSurface) as { keys: string[] }).keys;
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
      git('add', 'authorable-surface.json');
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
      expect(output).toContain('json-schema.manifest.json (#2978)');
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
      const handEdited = seedSurface((s) => s).replace(
        'Ratchet of every AUTHORABLE key',
        'Ratchet  of every AUTHORABLE key',
      );
      fs.writeFileSync(surfacePath, handEdited);

      const check = run(['--check']);
      expect(check.status).toBe(1);
      expect(check.output).toContain('does not match its generated form');
      expect(readSurface()).toBe(handEdited);

      const write = run([]);
      expect(write.status).toBe(0);
      expect(write.output).toContain('🔑 authorable-surface.json updated');
      expect(readSurface()).toBe(pristineSurface);
    },
  );

  it(
    'fails LOUDLY when origin/main cannot be resolved — a deletion check that silently skips is the bypass again',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedBase((s) => s);
      seedSurface((s) => s);
      git('update-ref', '-d', 'refs/remotes/origin/main');
      try {
        const { status, output } = run(['--check']);
        expect(status).toBe(1);
        expect(output).toContain('Cannot resolve origin/main');
        expect(output).toContain('#4650');
      } finally {
        git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      }
    },
  );

  it(
    'a declared def rename is not a deletion: base keys are carried through RENAMED_DEFS before comparing',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      expect(Object.keys(RENAMED_DEFS)).toContain('integration/RateLimitConfig');
      seedBase((s) => [...s, DELETED_BY_RENAME].sort());
      seedSurface((s) => s);

      const { status, output } = run(['--check']);

      expect(output).not.toContain('deleted without proof');
      expect(output).not.toContain('carry their own proof');
      expect(status).toBe(0);
    },
  );
});
