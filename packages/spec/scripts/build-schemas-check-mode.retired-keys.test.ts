// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 200 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause; apportioned 2026-10-23 when #25372 split build-schemas-check-mode.test.ts: the pre-split file's slowest CI reading (983.3 s, run 38798542648) x this file's share of one local whole-file run (130.9 of 828.2 s), x 1.25, rounded up; re-measure once CI has read this file on its own
//
// RETIRED_KEYS_BY_MAJOR rows, judged by exact key: check (b) matches the retired key,
// not its leaf (#4659); a nested retirement row is judged, not ignored (#17969).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CONVERSIONS_BY_MAJOR } from '../src/conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../src/migrations/registry';
// Read ONLY to keep the #17969 nested fixtures honest about the TREE FACTS they
// model — one nested key still writable, one nested key tombstoned — never to
// assert gate behaviour, which is read off the spawned run's output.
import { SchemaLevelIsolationStrategySchema } from '../src/system/tenant.zod';
import { AUTHORABLE_SURFACE_DIR_NAME, SCHEMA_MANIFEST_DIR_NAME } from './lib/sharded-artifacts';
import { AUTHORABLE_DEFAULTS_DIR_NAME } from './lib/authorable-defaults';
import {
  CURRENT_MAJOR,
  entryFile,
  fixtureTree,
  gitIn,
  HERMETIC_ENV,
  initFixtureRepo,
  mountCommittedLedgers,
  PKG,
  pristine,
  pristineDefaults,
  pristineSurface,
  REGEN_COMMAND,
  RETIRED_MARK,
  sandboxRoot,
  SPAWN_TIMEOUT_MS,
  STILL_LIVE_KEY,
  surfaceBaseDescription,
  TSX,
  useSharedSandbox,
  writeDefaultsShards,
  writeManifestShards,
  writeSurfaceShards,
} from './build-schemas-check-mode.fixture';

useSharedSandbox();

/** Retired keys whose ONLY registered clause names a DIFFERENT def — the defect. */
const LEAF_COLLIDER_A = 'api/HttpFindQueryParams:distinct';

/** …matched by this clause, which registers `data/Query`'s key, not this one. */
const LEAF_COLLIDER_A_CLAUSE = 'data.query.distinct';

/** The issue's own `.type` shape: an index type dated by a flow node rename. */
const LEAF_COLLIDER_B = 'data/Index:type';

/** …registered at protocol 11 by `flow-node-http-callout-rename`. Unrelated. */
const LEAF_COLLIDER_B_CLAUSE = 'flow.node.type';

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

  /** Same hermetic invocation as the sandbox's `git` — this box is a fixture
   *  repository too, and inherits nothing from the machine either (#9068). */
  const boxGit = (...args: string[]): string => gitIn(box, ...args);

  const runBox = (args: string[] = []): { status: number; output: string } => {
    const r = spawnSync(TSX, [boxScript, ...args], {
      cwd: box,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: HERMETIC_ENV,
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

    box = fixtureTree('build-schemas-retired-keys-');
    fs.cpSync(path.join(PKG, 'scripts'), path.join(box, 'scripts'), { recursive: true });
    fs.cpSync(path.join(PKG, 'src'), path.join(box, 'src'), { recursive: true });
    for (const entry of ['node_modules', 'package.json']) {
      fs.symlinkSync(path.join(PKG, entry), path.join(box, entry));
    }
    mountCommittedLedgers(box);
    writeManifestShards(path.join(box, SCHEMA_MANIFEST_DIR_NAME), pristine);
    boxSurfaceDir = path.join(box, AUTHORABLE_SURFACE_DIR_NAME);
    writeSurfaceShards(boxSurfaceDir, pristineSurface);
    // The #4666 default ratchet runs on every invocation, so every box needs its
    // committed record too — otherwise a fixture fails on a missing artifact
    // instead of on the removal/rename it is actually testing.
    writeDefaultsShards(path.join(box, AUTHORABLE_DEFAULTS_DIR_NAME), pristineDefaults);
    boxScript = path.join(box, 'scripts', 'build-schemas.ts');
    boxRegistry = path.join(box, 'src', 'migrations', 'registry.ts');
    pristineRegistry = fs.readFileSync(boxRegistry, 'utf8');

    initFixtureRepo(box);
    boxGit('add', AUTHORABLE_SURFACE_DIR_NAME, AUTHORABLE_DEFAULTS_DIR_NAME);
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
    if (box) fs.rmSync(sandboxRoot(box), { recursive: true, force: true });
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
      // The prescription IS the contract: the entry FILE to add per key, named
      // by the generator's own rule, and the generator command. RETIRED_KEYS_BY_MAJOR
      // is generated from those files, so a remedy that pastes lines into
      // src/migrations/registry.ts sends the author to an edit that is never
      // committed (the file is generated whole and git-ignored) and the next run
      // overwrites.
      const remedy = output.slice(output.indexOf(`2 ${CHECK_B}`));
      for (const key of [LEAF_COLLIDER_A, LEAF_COLLIDER_B]) {
        expect(remedy).toContain(entryFile('retired-keys', key));
        expect(remedy).toContain(`export const entry = '${key}';`);
        expect(remedy).not.toContain(`        '${key}',`);
      }
      expect(remedy).toContain(REGEN_COMMAND);
      expect(remedy).toContain('RETIRED_KEYS_BY_MAJOR');
      expect(remedy).not.toContain('migrations/registry.ts');
      expect(remedy).not.toContain('copy these lines');
      // The D2 conversion is still asked for — the table did not replace it.
      expect(remedy).toContain('src/conversions/registry.ts');
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
    'the printed route registers: write exactly the files check (b) names, run the generator, and (b) is silent',
    { timeout: SPAWN_TIMEOUT_MS * 3 },
    () => {
      // The case above registers by substituting the table. This one takes the
      // route the remedy PRINTS, literally: every file/declaration pair is read
      // off the red run's own output, written into the sandbox's entry
      // directory, and concatenated by the sandbox's own copy of the generator —
      // which refuses a file whose name does not match its id. So a remedy
      // naming a file the generator would reject, or a route that does not
      // register, goes red here rather than in an author's lap.
      fs.writeFileSync(boxRegistry, pristineRegistry); // the real generated table, markers intact
      untombstone(LEAF_COLLIDER_A, LEAF_COLLIDER_B);
      const written: string[] = [];
      try {
        const red = runBox(['--check']);
        expect(red.status).toBe(1);
        expect(red.output).toContain(`2 ${CHECK_B}`);

        const pairs = [
          ...red.output.matchAll(
            /^ +(packages\/spec\/src\/migrations\/entries\/retired-keys\/\S+\.ts)\n +(export const entry = '[^']+';)$/gm,
          ),
        ];
        expect(pairs.map((m) => m[2]).sort()).toEqual(
          [LEAF_COLLIDER_A, LEAF_COLLIDER_B].map((k) => `export const entry = '${k}';`).sort(),
        );
        for (const [, rel, declaration] of pairs) {
          const file = path.join(box, rel!.slice('packages/spec/'.length));
          expect(fs.existsSync(file), `${rel} already exists in the sandbox`).toBe(false);
          fs.writeFileSync(file, `// Fixture: registered by following check (b)'s remedy.\n${declaration}\n`);
          written.push(file);
        }

        const gen = spawnSync(TSX, [path.join(box, 'scripts', 'build-migration-registry.ts')], {
          cwd: box,
          encoding: 'utf8',
          timeout: SPAWN_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: HERMETIC_ENV,
        });
        expect(gen.status, `${gen.stdout ?? ''}${gen.stderr ?? ''}`).toBe(0);
        expect(gen.stdout).toContain('✓ wrote src/migrations/registry.ts');
        const regenerated = fs.readFileSync(boxRegistry, 'utf8');
        for (const k of [LEAF_COLLIDER_A, LEAF_COLLIDER_B]) expect(regenerated).toContain(`'${k}',`);

        const green = runBox(['--check']);
        expect(green.output).not.toContain(CHECK_B);
        expect(green.output).not.toContain('still LIVE');
        // Same residue as the case above: the baseline still owes `gen:schema`.
        expect(green.output).toContain('authorable-surface/ is out of date (2 key(s) not recorded)');
      } finally {
        for (const file of written) fs.rmSync(file, { force: true });
        fs.writeFileSync(boxRegistry, pristineRegistry);
      }
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
      expect(output).toContain(
        `     - ${STILL_LIVE_KEY}  (registered at major ${CURRENT_MAJOR})\n` +
          `         ${entryFile('retired-keys', STILL_LIVE_KEY)}\n`,
      );
      expect(output).toContain('retiredKey(');
      // Undoing a registration is an entry-file deletion plus the generator too.
      expect(output).toContain(REGEN_COMMAND);
      expect(output).not.toContain('migrations/registry.ts');
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

/** A live NESTED key — (b2)'s own defect, one level down. */
const NESTED_LIVE_KEY = 'system/SchemaLevelIsolationStrategy:performance.poolPerSchema';

/** A real registered nested retirement (#15939 ruling A): the dark control. */
const NESTED_RETIRED_KEY = 'system/SchemaLevelIsolationStrategy:performance.schemaCacheTTL';

/** The card's probe: a path under a live nested object that no build emits. */
const NESTED_TYPO_KEY = 'system/SchemaLevelIsolationStrategy:performance.zzNotARealKey9999';

/** Fabricated, and under a def retired WHOLE (the change-management family) —
 *  the second dark control: absent for a reason the manifest ratchet owns. */
const NESTED_UNEMITTED_DEF_KEY = 'system/ChangeImpact:downtime.zzNotARealKey9999';

/** The def both nested fixtures live on, and the def the last one does not. */
const NESTED_FIXTURE_DEF = 'system/SchemaLevelIsolationStrategy';

const UNEMITTED_FIXTURE_DEF = 'system/ChangeImpact';

/**
 * Every baseline key whose NAME half carries a dot — and every one of them is a
 * TOP-LEVEL property name that contains one, never a nested path: the OData
 * annotations a response envelope publishes, and a SCIM extension URN. Routing
 * has to ask the schema rather than the spelling because of exactly these.
 */
const DOTTED_TOP_LEVEL_BASELINE_KEYS = [
  'api/ODataResponse:@odata.context',
  'api/ODataResponse:@odata.count',
  'api/ODataResponse:@odata.nextLink',
  'identity/SCIMUser:urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
];

/** …and the one of them this build still emits as LIVE — the routing fixture. */
const DOTTED_TOP_LEVEL_LIVE_KEY = 'api/ODataResponse:@odata.context';

const CHECK_B3 = 'RETIRED_KEYS_BY_MAJOR entr(ies) name a NESTED key this build does not emit';

const CHECK_B2 = 'RETIRED_KEYS_BY_MAJOR entr(ies) name a key that is still LIVE';

describe('build-schemas.ts — a nested retirement row is judged, not ignored (#17969)', () => {
  let box: string;
  let boxScript: string;
  let boxRegistry: string;
  let pristineRegistry: string;

  /** Same hermetic invocation as the sandbox's `git` — this box is a fixture
   *  repository too, and inherits nothing from the machine either (#9068). */
  const boxGit = (...args: string[]): string => gitIn(box, ...args);

  const runBox = (args: string[] = []): { status: number; output: string } => {
    const r = spawnSync(TSX, [boxScript, ...args], {
      cwd: box,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: HERMETIC_ENV,
    });
    return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  /** Substitute RETIRED_KEYS_BY_MAJOR in this box's own copy of the registry. */
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

  beforeAll(() => {
    // ── Fixture validity, loud ───────────────────────────────────────────
    // The PREMISE of the whole limb: the published baseline records def
    // TOP-LEVEL keys only, so a nested key has no baseline line, no `[RETIRED]`
    // mark and no aging clock — which is why check (b3) can read an absent
    // nested path as a wrong row rather than as a steady state.
    //
    // The baseline's dotted entries are the OTHER shape: top-level property
    // NAMES that carry a dot. Enumerated rather than counted, because what this
    // assertion is really watching for is a nested PATH appearing here — the
    // published surface widened, which is the thing #17969 deliberately did not
    // do (recursing `currentKeys` in place measures at +14,376 lines). A new
    // dotted top-level key is a one-line update here; 14,376 of them is the
    // finding.
    const dotted = pristineSurface
      .map((e) => e.replace(RETIRED_MARK, ''))
      .filter((e) => e.slice(e.indexOf(':') + 1).includes('.'))
      .sort();
    expect(
      dotted,
      `${AUTHORABLE_SURFACE_DIR_NAME}/ carries a dotted key this roster does not name — if it is a ` +
        'nested PATH, the published surface has been widened and check (b3) has to be re-derived',
    ).toEqual([...DOTTED_TOP_LEVEL_BASELINE_KEYS].sort());

    // The tree facts each fixture models, read from the schema source itself so
    // a fixture cannot quietly stop being the thing it claims to be.
    const live = SchemaLevelIsolationStrategySchema.safeParse({
      strategy: 'isolated_schema',
      performance: { poolPerSchema: true },
    });
    expect(live.success, `${NESTED_LIVE_KEY} is no longer writable — re-pick the live fixture`).toBe(true);
    const tombstoned = SchemaLevelIsolationStrategySchema.safeParse({
      strategy: 'isolated_schema',
      performance: { schemaCacheTTL: 3600 },
    });
    expect(
      tombstoned.success,
      `${NESTED_RETIRED_KEY} is no longer a tombstone — re-pick the dark control`,
    ).toBe(false);

    // The def halves: one this build emits, one it does not.
    expect(pristine, `${NESTED_FIXTURE_DEF} is no longer emitted — re-pick`).toContain(NESTED_FIXTURE_DEF);
    expect(pristine, `${UNEMITTED_FIXTURE_DEF} is emitted now — re-pick the def-level control`).not.toContain(
      UNEMITTED_FIXTURE_DEF,
    );

    // The registered row the dark control models is real; the fabricated ones
    // are not registered anywhere.
    const declared = Object.values(RETIRED_KEYS_BY_MAJOR).flat();
    expect(declared, `${NESTED_RETIRED_KEY} is no longer registered — re-pick`).toContain(NESTED_RETIRED_KEY);
    for (const fabricated of [NESTED_TYPO_KEY, NESTED_UNEMITTED_DEF_KEY, NESTED_LIVE_KEY]) {
      expect(declared, `${fabricated} is registered for real — pick another fixture`).not.toContain(fabricated);
    }
    expect(declared, `${DOTTED_TOP_LEVEL_LIVE_KEY} is registered for real — re-pick`).not.toContain(
      DOTTED_TOP_LEVEL_LIVE_KEY,
    );
    expect(
      pristineSurface,
      `${DOTTED_TOP_LEVEL_LIVE_KEY} is no longer a LIVE top-level key — re-pick the routing fixture`,
    ).toContain(DOTTED_TOP_LEVEL_LIVE_KEY);
    // The census case below is only worth its spawn while the table HAS nested
    // rows to judge.
    expect(declared.filter((k) => k.slice(k.indexOf(':') + 1).includes('.')).length).toBeGreaterThan(0);

    box = fixtureTree('build-schemas-nested-retired-');
    fs.cpSync(path.join(PKG, 'scripts'), path.join(box, 'scripts'), { recursive: true });
    fs.cpSync(path.join(PKG, 'src'), path.join(box, 'src'), { recursive: true });
    for (const entry of ['node_modules', 'package.json']) {
      fs.symlinkSync(path.join(PKG, entry), path.join(box, entry));
    }
    mountCommittedLedgers(box);
    writeManifestShards(path.join(box, SCHEMA_MANIFEST_DIR_NAME), pristine);
    writeSurfaceShards(path.join(box, AUTHORABLE_SURFACE_DIR_NAME), pristineSurface);
    // The #4666 default ratchet runs on every invocation, so every box needs its
    // committed record too — otherwise a fixture fails on a missing artifact
    // instead of on the row it is actually testing.
    writeDefaultsShards(path.join(box, AUTHORABLE_DEFAULTS_DIR_NAME), pristineDefaults);
    boxScript = path.join(box, 'scripts', 'build-schemas.ts');
    boxRegistry = path.join(box, 'src', 'migrations', 'registry.ts');
    pristineRegistry = fs.readFileSync(boxRegistry, 'utf8');

    initFixtureRepo(box);
    boxGit('add', AUTHORABLE_SURFACE_DIR_NAME, AUTHORABLE_DEFAULTS_DIR_NAME);
    boxGit('commit', '-q', '-m', `baseline: committed ${AUTHORABLE_SURFACE_DIR_NAME}/`);
    fs.writeFileSync(
      path.join(box, 'authorable-surface.base.json'),
      JSON.stringify(
        { description: surfaceBaseDescription, baseRev: boxGit('rev-parse', 'HEAD'), keys: pristineSurface },
        null,
        2,
      ) + '\n',
    );
    boxGit('add', 'authorable-surface.base.json');
    boxGit('commit', '-q', '-m', 'baseline anchor');
    boxGit('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  afterAll(() => {
    if (box) fs.rmSync(sandboxRoot(box), { recursive: true, force: true });
  });

  it(
    'PROBE: a fabricated nested row is REFUSED — the run the card measured at exit 0',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedRetiredKeys({ [CURRENT_MAJOR]: [NESTED_TYPO_KEY] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${CHECK_B3}`);
      expect(output).toContain(
        `     - ${NESTED_TYPO_KEY}  (registered at major ${CURRENT_MAJOR})\n` +
          `         ${entryFile('retired-keys', NESTED_TYPO_KEY)}\n`,
      );
      expect(output).toContain(REGEN_COMMAND);
      expect(output).not.toContain('migrations/registry.ts');
      // Judged as absent, not as live: the two verdicts have different remedies.
      expect(output).not.toContain(CHECK_B2);
      // The refusal carries the remedy, including the one legitimate shape it
      // cannot see — so the next author extends the check instead of deleting a
      // row that is telling the truth.
      expect(output).toContain('Fix the spelling against the emitted schema');
      expect(output).toContain('check (c) proof 4');
    },
  );

  it(
    'LIT CONTROL: a live TOP-LEVEL key is still refused, on the same message as before',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The guard that already worked must not regress: (b2) reads `currentKeys`
      // for a top-level row exactly as it did, and says the same thing.
      seedRetiredKeys({ [CURRENT_MAJOR]: [STILL_LIVE_KEY] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${CHECK_B2}`);
      expect(output).toContain(`     - ${STILL_LIVE_KEY}  (registered at major ${CURRENT_MAJOR})`);
      expect(output).toContain('retiredKey(');
      expect(output).not.toContain(CHECK_B3);
    },
  );

  it(
    'a live NESTED key is refused by (b2) too — the same defect, one level down',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // This is the row the top-level-only map could never see: the key is
      // writable today, so the entry pre-approves a retirement nobody performed
      // and check (b) would wave the real tombstone through later.
      seedRetiredKeys({ [CURRENT_MAJOR]: [NESTED_LIVE_KEY] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${CHECK_B2}`);
      expect(output).toContain(`     - ${NESTED_LIVE_KEY}  (registered at major ${CURRENT_MAJOR})`);
      expect(output).not.toContain(CHECK_B3);
    },
  );

  it(
    'a live TOP-LEVEL key whose own NAME carries a dot is judged as one, not as a path',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // `@odata.context` is a property name, not `context` inside `@odata`. A
      // gate that routed on the spelling would resolve it as a path, find
      // nothing, and answer with (b3)'s "does not emit" — the right refusal for
      // the wrong reason, and the wrong remedy printed under it.
      seedRetiredKeys({ [CURRENT_MAJOR]: [DOTTED_TOP_LEVEL_LIVE_KEY] });

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain(`1 ${CHECK_B2}`);
      expect(output).toContain(`     - ${DOTTED_TOP_LEVEL_LIVE_KEY}  (registered at major ${CURRENT_MAJOR})`);
      expect(output).not.toContain(CHECK_B3);
    },
  );

  it(
    'DARK CONTROL: a real nested retirement PASSES — discrimination, not a blanket refusal',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Without this case, a check that refused every dotted row would satisfy
      // the probe and the lit control both, and be a new false red on 48 rows.
      seedRetiredKeys({ [CURRENT_MAJOR]: [NESTED_RETIRED_KEY] });

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(CHECK_B3);
      expect(output).not.toContain(CHECK_B2);
      expect(output).not.toContain('deleted without proof');
      expect(status).toBe(0);
    },
  );

  it(
    'DARK CONTROL: a nested row under a def this build does not emit PASSES — the steady state',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // A whole-def removal is registered in RETIRED_DEFS_BY_MAJOR and
      // adjudicated by the json-schema.manifest/ ratchet, which subsumes the key
      // entries under it. Three shipped nested rows are in this state; reading
      // them as typos would be this gate's own false red. Fabricated on purpose:
      // absence is waived by the DEF's state, never by the path being real.
      seedRetiredKeys({ [CURRENT_MAJOR]: [NESTED_UNEMITTED_DEF_KEY] });

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(CHECK_B3);
      expect(output).not.toContain(CHECK_B2);
      expect(status).toBe(0);
    },
  );

  it(
    'the shipped table passes the new limb — the population the card left unmeasured',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The card measured the predicate and said so: "how many of the 36 nested
      // rows are accurate is not measured by this card and not measured by
      // anything else". This is that measurement, kept measured — every dotted
      // row in the real table either resolves to a tombstone or names a def this
      // build does not emit.
      seedRetiredKeys({ ...RETIRED_KEYS_BY_MAJOR });

      const { status, output } = runBox(['--check']);

      expect(output).not.toContain(CHECK_B3);
      expect(output).not.toContain(CHECK_B2);
      expect(status).toBe(0);
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #18865 — proof 4's message leg, defended by a fixture instead of by a zero.
//
// `delivers()` in build-schemas.ts is a CONJUNCTION, and check (c) counts a
// refusal it cannot read as "no evidence" rather than as proof:
//
//     issue !== undefined && issue.message.includes(prescription)
//
// The left half — "the door refused this write" — is what the `ui/ViewItem`
// fixture above defends: a discriminated union the probe's one-key document
// cannot drive to any arm's door raises no `unrecognized_keys` issue at all, so
// `issue` is `undefined`. That fixture ASSERTS the probe raises no such issue,
// which means `&&` short-circuits in it and the right half is never evaluated —
// delete the `message.includes` conjunct and its verdict does not move, nor does
// any other case in this file. Measured before this block was written: the leg
// was defended by a zero.
//
// The right half is the only thing that separates a def which parses through the
// declaration's own error map from a strict CLONE built to the same declaration
// that does not — `Strict.strip()`, `z.object(Strict.shape)`, an `.extend()`
// that re-posts the shape without the map. Shape identity cannot tell them apart
// (that is the narrowing `computeGuidanceRoutes`'s docblock records), and the
// clone refuses the key with zod's own bare "Unrecognized key", carrying none of
// the prescription its declaration owes.
//
// ⚠️ The failure direction is "reads as compliant": with that conjunct gone the
// silent clone reads as `prescribed` and its deletion is WAIVED — the one
// direction this gate must not err in. So the pin below is the LIT case, and the
// tree's real door is the DARK one beside it; a gate that lost the leg turns the
// first red and leaves the second green.
//
// ── Why a FIFTH box ──────────────────────────────────────────────────────────
// The subject is a def built WITHOUT its declaration's error map, and the tree
// holds no such def any more (#18578 closed the last silent twin, which is what
// turned the `ui/ViewItem` pair into this file's DARK leg). So the fixture makes
// one, by substituting `strictObject` in this box's OWN copy of `src/` — exactly
// as the #4659 and #17969 boxes substitute `RETIRED_KEYS_BY_MAJOR`, and for the
// same reason: the shared sandbox SYMLINKS `src/`, so writing a fixture there
// would write the repo's own source (and `@objectstack/spec`'s `files[]` carries
// `src/**/*.zod.ts`, so it would ship). The gate under test is still the copied
// `scripts/build-schemas.ts`, byte for byte, and no test-only seam is added to
// it — what differs is the fixture's spec source, which is data exactly as the
// fabricated `refs/remotes/origin/main` is.
