// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 190 — spawns the real producer once per single-cause fixture: every case runs the real schema generator (build-schemas.ts --check) in its own sandbox git tree, one fixture per cause; apportioned 2026-10-23 when #25372 split build-schemas-check-mode.test.ts: the pre-split file's slowest CI reading (983.3 s, run 38798542648) x this file's share of one local whole-file run (127.1 of 828.2 s), x 1.25, rounded up; re-measure once CI has read this file on its own
//
// A deleted manifest key must prove itself (#4725); check (c) dates a tombstone by its
// exact key (#5898); proof 4 reads the refusal text (#18865).
//
// One of the `build-schemas-check-mode.*.test.ts` files (#25372 split the one
// file so the repo project's workers run its blocks in parallel). The family's
// header — what `--check` pins and why every case runs in a sandbox git tree —
// and the shared sandbox, helpers and constants live in
// `build-schemas-check-mode.fixture.ts`.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { RENAMED_DEFS } from './lib/renamed-defs';
import { RETIRED_DEFS_BY_MAJOR } from '../src/migrations/registry';
// Read ONLY to keep the #18301 DOOR fixture honest about the tree fact it models
// — ONE `strictObject` declaration whose shape entries two emitted defs share,
// one of which never closed its door. Never to assert gate behaviour.
import { RateLimitConfigSchema } from '../src/shared/http.zod';
import { ServerRateLimitConfigSchema } from '../src/system/stack-server.zod';
import { AUTHORABLE_SURFACE_DIR_NAME, SCHEMA_MANIFEST_DIR_NAME } from './lib/sharded-artifacts';
import { AUTHORABLE_DEFAULTS_DIR_NAME } from './lib/authorable-defaults';
import {
  CURRENT_MAJOR,
  DELETED_AGED,
  DELETED_AGED_LEAF,
  DELETED_SERVER_TWIN,
  EAGER_SCHEMAS_ENV,
  entryFile,
  fixtureTree,
  gitIn,
  HERMETIC_ENV,
  initFixtureRepo,
  minRegisteredMajorForLeaf,
  mountCommittedLedgers,
  PKG,
  PRESCRIPTION_BULLET,
  pristine,
  pristineDefaults,
  pristineSurface,
  REGEN_COMMAND,
  RETIRED_MARK,
  sandboxRoot,
  SERVER_TWIN_DEF,
  shardBytes,
  SHARED_TWIN_DEF,
  SPAWN_TIMEOUT_MS,
  surfaceBaseDescription,
  TSX,
  TWIN_LEAF,
  TWIN_VALID,
  useSharedSandbox,
  writeDefaultsShards,
  writeManifestShards,
  writeSurfaceShards,
} from './build-schemas-check-mode.fixture';

useSharedSandbox();

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

    box = fixtureTree('build-schemas-manifest-removal-');
    fs.cpSync(path.join(PKG, 'scripts'), path.join(box, 'scripts'), { recursive: true });
    fs.cpSync(path.join(PKG, 'src'), path.join(box, 'src'), { recursive: true });
    for (const entry of ['node_modules', 'package.json']) {
      fs.symlinkSync(path.join(PKG, entry), path.join(box, entry));
    }
    mountCommittedLedgers(box);
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
    writeDefaultsShards(path.join(box, AUTHORABLE_DEFAULTS_DIR_NAME), pristineDefaults);
    initFixtureRepo(box);
    // BOTH artifacts tracked here: the merge-base manifest is what this gate
    // reads, and the surface baseline keeps the #4650 gate honest alongside it.
    boxGit('add', SCHEMA_MANIFEST_DIR_NAME, AUTHORABLE_SURFACE_DIR_NAME, AUTHORABLE_DEFAULTS_DIR_NAME);
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
    if (box) fs.rmSync(sandboxRoot(box), { recursive: true, force: true });
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
      // The prescription IS the contract: the entry FILE to add per def, named
      // by the generator's own rule, and the generator command — never lines to
      // paste into the generated table in src/migrations/registry.ts.
      const remedy = output.slice(output.indexOf(`2 ${NO_REGISTERED_REMOVAL}`));
      for (const def of [REMOVED_DEF, REMOVED_DEF_2]) {
        expect(remedy).toContain(entryFile('retired-defs', def));
        expect(remedy).toContain(`export const entry = '${def}';`);
        expect(remedy).not.toContain(`        '${def}',`);
      }
      expect(remedy).toContain(REGEN_COMMAND);
      expect(remedy).toContain('RETIRED_DEFS_BY_MAJOR');
      expect(remedy).not.toContain('migrations/registry.ts');
      expect(remedy).not.toContain('copy these lines');
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
      expect(output).toContain(
        `     - ${STILL_PUBLISHED_DEF}  (registered at major ${CURRENT_MAJOR})\n` +
          `         ${entryFile('retired-defs', STILL_PUBLISHED_DEF)}\n`,
      );
      expect(output).toContain(REGEN_COMMAND);
      expect(output).not.toContain('migrations/registry.ts');
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
        // …and the entry file that registers it, never a line for the table.
        expect(output).toContain(entryFile('retired-defs', def));
        expect(output).toContain(`export const entry = '${def}';`);
      }
      // The old verdict, in full: check (c) waived all 116 lines as "def no
      // longer emitted", the manifest ratchet said nothing, and the run exited
      // 0. The gate now exits before check (c) reaches that branch at all.
      expect(output).not.toContain('carry their own proof');
      expect(output).not.toContain('baseline deletion(s) since');
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #5898 — check (c) dates a tombstone by its EXACT key, not by its leaf.
//
// #4659 moved check (b) off leaf-name matching and left check (c) on it, in the
// open, with a comment saying so: (c) adjudicates HISTORICAL tombstones, all 97
// of which predate RETIRED_KEYS_BY_MAJOR, so pointing it at that table meant
// first deciding what to do about rows nothing could date.
//
// The two consequences both pointed at "release early", and both were live on
// the real baseline — 2 of the 97 rows were deletable, and BOTH were false
// positives, by different mechanisms:
//
//   - `data/Index:type` was dated by `flow.node.type` (protocol 11,
//     `flow-node-http-callout-rename`) — an unrelated cluster that merely ends
//     in the same leaf. Its own clause, `object.indexes[].type`, is major 17.
//   - `api/RestApiConfig:requireAuth` was dated by `api.requireAuth` at major
//     12 — which is `rest-requireauth-default-flip`, a secure-DEFAULT flip whose
//     step states "No metadata shape changed". Its retirement is the protocol 17
//     conversion `stack.api.requireAuth` (#3963). Same surface, different KIND
//     of change, five majors early.
//
// So the backfill was not attempted: leaf-matching the registry is the very
// inference #4659 removed, and `authorable-surface.json`'s git history starts at
// 17.0.0-rc.0 and therefore dates all 97 rows at major 17 — the file's birth,
// not archaeology. Undated ⇒ undeletable, and the after-count is 0 of 97 by
// design. The gate below is what that costs and what it buys.
//
// This block needs its own sandbox because the aged-out branch is now a claim
// about `src/migrations/registry.ts`, which the main sandbox symlinks.

/** A tombstone declared at a major far enough back to have aged out. */
const AGED_DECLARED_MAJOR = 11;

/** …and one declared at the current major, which has not. */
const UNAGED_DECLARED_KEY = 'data/Object:zzDeclaredThisMajor5898';

const UNAGED_DECLARED = `${UNAGED_DECLARED_KEY} [RETIRED]`;

describe('build-schemas.ts — check (c) dates a tombstone by its exact key (#5898)', () => {
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

  /** Commit a BASE carrying extra lines; the worktree keeps the pristine set,
   *  so those lines read as deleted by this build (the main sandbox's shape). */
  const seedBoxBase = (...extra: string[]): void => {
    writeSurfaceShards(boxSurfaceDir, [...pristineSurface, ...extra].sort());
    boxGit('add', AUTHORABLE_SURFACE_DIR_NAME, AUTHORABLE_DEFAULTS_DIR_NAME);
    boxGit('commit', '-q', '--allow-empty', '-m', 'base variant');
    boxGit('update-ref', 'refs/remotes/origin/main', boxGit('rev-parse', 'HEAD'));
    writeSurfaceShards(boxSurfaceDir, pristineSurface);
  };

  beforeAll(() => {
    // Fixture validity, loud. The aged fixture must NOT owe its verdict to a
    // clause match — that is the whole point — so its leaf is checked to be
    // registered no earlier than the major we declare it at is irrelevant; what
    // matters is that the key is not already in the baseline or the real table.
    for (const injected of [DELETED_AGED, UNAGED_DECLARED]) {
      expect(
        pristineSurface.includes(injected) ||
          pristineSurface.includes(injected.replace(RETIRED_MARK, '')),
        `fixture ${injected} already exists in the committed baseline — pick another`,
      ).toBe(false);
    }
    expect(CURRENT_MAJOR - AGED_DECLARED_MAJOR).toBeGreaterThanOrEqual(2);

    box = fixtureTree('build-schemas-tombstone-age-');
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
    'a tombstone DECLARED at an aged major may have its baseline line deleted',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The surviving positive route. Note what supplies the major: the table,
      // not the leaf — `compactLayout` happens to have an old clause too, so
      // this case alone cannot tell the two mechanisms apart. The pin that can
      // is in the main sandbox (`data/Object:type`) and in the last test here.
      seedRetiredKeys({ [AGED_DECLARED_MAJOR]: [DELETED_AGED.replace(RETIRED_MARK, '')] });
      seedBoxBase(DELETED_AGED);

      const { status, output } = runBox(['--check']);

      expect(output).toContain('carry their own proof (#4650)');
      expect(output).toMatch(
        new RegExp(
          `data/Object:${DELETED_AGED_LEAF} — \\[RETIRED\\] at [0-9a-f]+ and registered at major ${AGED_DECLARED_MAJOR}`,
        ),
      );
      expect(output).toContain('tombstone aged out');
      expect(status).toBe(0);
    },
  );

  it(
    'a tombstone DECLARED at the current major is not deletable yet',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      seedRetiredKeys({ [CURRENT_MAJOR]: [UNAGED_DECLARED_KEY] });
      seedBoxBase(UNAGED_DECLARED);

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toMatch(
        new RegExp(`${UNAGED_DECLARED_KEY} — .*tombstone registered at major ${CURRENT_MAJOR}`),
      );
      expect(output).toMatch(/must age ≥ 2 majors/);
    },
  );

  it(
    'the pin: with the table EMPTY, a leaf collision proves nothing — the deletion is refused',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // `compactLayout` is registered at protocol 11 by an ADR-0087 clause, so
      // the pre-#5898 matcher dated it there and allowed the deletion — exit 0,
      // "tombstone aged out". With the declaration removed and nothing else
      // changed, the only thing that can still supply major 11 is leaf matching.
      expect(minRegisteredMajorForLeaf(DELETED_AGED_LEAF)).toBe(AGED_DECLARED_MAJOR);
      seedRetiredKeys({});
      seedBoxBase(DELETED_AGED);

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('deleted without proof (#4650)');
      expect(output).toMatch(
        new RegExp(`data/Object:${DELETED_AGED_LEAF} — .*no entry in RETIRED_KEYS_BY_MAJOR`),
      );
      expect(output).not.toContain('tombstone aged out');
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// #17969 — a NESTED RETIRED_KEYS_BY_MAJOR row is judged, not ignored.
//
// `currentKeys` is built from `schema.properties` ONE LEVEL DEEP, so a dotted
// row — 48 of the shipped entries — matched nothing in the map check (b2)
// consults and was silently IGNORED. Ablated on `origin/main` before the fix,
// with controls: a fabricated nested row passed `check:authorable-surface` at
// exit 0 with zero ❌, while a live TOP-LEVEL key was refused at exit 1. A
// typo'd def, a typo'd path or a stale key name therefore registered silently
// and stayed registered — and the retirement ledger is the input to the
// ADR-0087 conversions downstream, so the error is inherited as fact.
//
// The fix is NOT "recurse `currentKeys`": three lines below its construction
// that same map is `currentEntries`, the PUBLISHED authorable-surface baseline,
// and recursing it in place measures at +14,376 lines across all 14 shards.
// The nested view is resolved for the registered rows only, by
// `scripts/lib/nested-authorable-keys.ts`, and reaches nothing that emits.
//
// The four cases below are the acceptance, and the two DARK controls are the
// half that cannot be skipped: a check that refused every nested row would pass
// the probe and the lit control alike, and be a new false red on 48 rows.
//
// This block needs its own sandbox for the reason the #4659 one gives: the
// fixture is a claim about `src/migrations/registry.ts`, which the main sandbox
// symlinks.

/** The anchor this fixture substitutes — `strictObject`'s own declaration. */
const STRICT_OBJECT_ANCHOR =
  /export function strictObject<T extends z\.ZodRawShape>\(options: StrictObjectOptions, shape: T\) \{\n[\s\S]*?\n\}\n/;

describe('build-schemas.ts — proof 4 reads the REFUSAL TEXT: a strict clone without the declaration\'s error map proves nothing (#18865)', () => {
  let box: string;
  let boxScript: string;
  let boxSurfaceDir: string;
  let boxStrictObject: string;
  let pristineStrictObject: string;
  let canonicalBoxSurface: string;

  /** Same hermetic invocation as the sandbox's `git` — this box is a fixture
   *  repository too, and inherits nothing from the machine either (#9068). */
  const boxGit = (...args: string[]): string => gitIn(box, ...args);

  const runBox = (args: string[] = []): { status: number; output: string } => {
    const r = spawnSync(TSX, [boxScript, ...args], {
      cwd: box,
      encoding: 'utf8',
      timeout: SPAWN_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The gate reads `zodByDefKey` for the probe, so it must hold the real
      // instances rather than `lazySchema`'s Proxy — `check:authorable-surface`
      // exports this and so does `gen:schema`.
      env: { ...HERMETIC_ENV, ...EAGER_SCHEMAS_ENV },
    });
    return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };

  /**
   * Rebuild `strictObject` in this box's own `src/` so every closed shape is a
   * strict clone of its declaration that does NOT carry the declaration's error
   * map: the declaration is still registered (proof 4's first half still finds
   * the promise), the door is still closed (the probe still gets an
   * `unrecognized_keys` issue naming the key), and the refusal carries zod's
   * bare text instead of the prescription.
   */
  const dropErrorMaps = (): void => {
    const rendered =
      `export function strictObject<T extends z.ZodRawShape>(options: StrictObjectOptions, shape: T) {\n` +
      `  strictObjectError(options, shape);\n` +
      `  return z.object(shape).strict();\n` +
      `}\n`;
    expect(
      STRICT_OBJECT_ANCHOR.test(pristineStrictObject),
      '`strictObject` is no longer one function declaration in src/shared/strict-object.ts — this ' +
        'fixture substitutes it textually and can no longer find it',
    ).toBe(true);
    fs.writeFileSync(boxStrictObject, pristineStrictObject.replace(STRICT_OBJECT_ANCHOR, rendered));
  };

  /** Put this box's `src/` back to the tree's own bytes — the DARK leg's state. */
  const keepErrorMaps = (): void => {
    fs.writeFileSync(boxStrictObject, pristineStrictObject);
  };

  beforeAll(() => {
    // ── Fixture validity, loud ───────────────────────────────────────────────
    // Every half below can rot on its own, and each one rots this pin into a
    // green that asserts nothing about the leg.
    expect(
      pristineSurface,
      `${DELETED_SERVER_TWIN} is a real baseline line now — check (c) only ever sees a key the ` +
        `build STOPPED emitting, so this fixture needs a key the baseline does not carry`,
    ).not.toContain(DELETED_SERVER_TWIN);
    expect(
      pristine,
      `${SERVER_TWIN_DEF} is no longer emitted — check (c) would route this deletion to the ` +
        `vanished-def proof instead; re-pick the def`,
    ).toContain(SERVER_TWIN_DEF);
    expect(
      Object.keys(RateLimitConfigSchema.shape),
      `'${TWIN_LEAF}' is DECLARED on the shape again — it would never reach the unrecognized-key ` +
        `path, so nothing here models a guidance route`,
    ).not.toContain(TWIN_LEAF);

    // The DARK leg's tree fact: the real def parses through the declaration's own
    // error map, so its refusal CARRIES the prescription.
    const delivered = ServerRateLimitConfigSchema.safeParse({ ...TWIN_VALID, [TWIN_LEAF]: 'ip' });
    expect(
      delivered.success,
      `${SERVER_TWIN_DEF} now ACCEPTS '${TWIN_LEAF}' — its door re-opened and the DARK leg below ` +
        `would stop being a delivery at all`,
    ).toBe(false);
    expect(
      delivered.success ? '' : delivered.error.issues.map((i) => i.message).join('\n'),
      `${SERVER_TWIN_DEF} rejects '${TWIN_LEAF}' with no prescription — the \`guidance\` entry that ` +
        `is this block's whole subject has gone`,
    ).toContain(PRESCRIPTION_BULLET);

    // The LIT leg's tree fact, taken in process on the very construction the
    // fixture substitutes: a strict clone built from the same shape refuses the
    // key — so the probe DOES get its `unrecognized_keys` issue and `&&` does not
    // short-circuit — and the refusal carries no prescription. This is what makes
    // the case below a pin on the MESSAGE half rather than a second copy of the
    // `ui/ViewItem` pin on the issue-is-undefined half.
    const clone = z.object(RateLimitConfigSchema.shape).strict();
    const silent = clone.safeParse({ ...TWIN_VALID, [TWIN_LEAF]: 'ip' });
    expect(
      silent.success,
      `a strict clone of ${SHARED_TWIN_DEF}'s shape now ACCEPTS '${TWIN_LEAF}' — the fixture would ` +
        `model an OPEN door, which is the issue-is-undefined half, not this one`,
    ).toBe(false);
    expect(
      silent.success ? [] : silent.error.issues.map((i) => i.code),
      `a strict clone without the error map no longer answers with an unrecognized-key issue — ` +
        `\`delivers()\` would short-circuit on its LEFT half and this block would pin nothing`,
    ).toContain('unrecognized_keys');
    expect(
      silent.success ? '' : silent.error.issues.map((i) => i.message).join('\n'),
      `zod's own unrecognized-key message now carries the prescription bullet — a clone without the ` +
        `declaration's error map has stopped being silent and this fixture models nothing`,
    ).not.toContain(PRESCRIPTION_BULLET);

    box = fixtureTree('build-schemas-proof4-message-leg-');
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
    // instead of on the row it is actually testing.
    writeDefaultsShards(path.join(box, AUTHORABLE_DEFAULTS_DIR_NAME), pristineDefaults);
    boxScript = path.join(box, 'scripts', 'build-schemas.ts');
    boxStrictObject = path.join(box, 'src', 'shared', 'strict-object.ts');
    pristineStrictObject = fs.readFileSync(boxStrictObject, 'utf8');

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
    // The BASE carries one extra line; the worktree is put back to the live set
    // so check (a) stays silent and check (c) sees exactly one deleted key. Same
    // shape as `seedBase` above, kept local because this box owns its own repo.
    writeSurfaceShards(boxSurfaceDir, [...pristineSurface, DELETED_SERVER_TWIN].sort());
    boxGit('add', AUTHORABLE_SURFACE_DIR_NAME);
    boxGit('commit', '-q', '-m', 'base variant: one extra authorable line');
    boxGit('update-ref', 'refs/remotes/origin/main', boxGit('rev-parse', 'HEAD'));
    canonicalBoxSurface = writeSurfaceShards(boxSurfaceDir, pristineSurface);
  });

  afterAll(() => {
    if (box) fs.rmSync(sandboxRoot(box), { recursive: true, force: true });
  });

  it(
    'LIT — a strict clone that does not carry its declaration\'s error map is NOT proof: the deletion is refused',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // The whole of #18865 in one run. The declaration still NAMES `keyBy`, the
      // door is still closed, the probe still gets its `unrecognized_keys` issue
      // — and the refusal carries zod's bare text, not the prescription. Only
      // `issue.message.includes(prescription)` can see the difference, so this
      // case is red for exactly that conjunct and for nothing else.
      dropErrorMaps();

      const { status, output } = runBox(['--check']);

      expect(status).toBe(1);
      expect(output).toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(output).toMatch(
        new RegExp(
          `${DELETED_SERVER_TWIN.replace(/[/$]/g, '\\$&')} — def .*; a \`strictObject\` declaration ` +
            `NAMES '${TWIN_LEAF}', but writing it`,
        ),
      );
      // ⭐ The waiver is the failure direction, named. A gate that lost the
      // message leg prints THIS instead, exits 0, and reads as compliant.
      expect(output).not.toContain('carries the prescription its `strictObject` declaration owes');
      expect(output).not.toMatch(
        new RegExp(
          `${DELETED_SERVER_TWIN.replace(/[/$]/g, '\\$&')} — def .*is REFUSED as an unrecognized key`,
        ),
      );
      // …and it is not being refused by some OTHER proof either: the def is
      // root-reachable and its baseline entry was never `[RETIRED]`, so without
      // these legs the case would pass on a gate that had simply stopped emitting
      // proof 4 at all.
      expect(output).not.toMatch(
        new RegExp(`${DELETED_SERVER_TWIN.replace(/[/$]/g, '\\$&')} — def not reachable from the`),
      );
      expect(output).not.toMatch(
        new RegExp(
          `${DELETED_SERVER_TWIN.replace(/[/$]/g, '\\$&')} — def .*was LIVE \\(never tombstoned\\)\\.`,
        ),
      );

      // A check reports; it does not write (#4711) — this file's founding
      // assertion, and the one a fixture that mutates `src/` most needs.
      expect(shardBytes(boxSurfaceDir)).toBe(canonicalBoxSurface);
    },
  );

  it(
    'DARK — the tree\'s own door, same key, same box: the refusal carries the prescription and the deletion IS waived',
    { timeout: SPAWN_TIMEOUT_MS },
    () => {
      // Without this leg the case above passes on a gate that waives nothing —
      // "refuse everything" and "read the message" are indistinguishable from one
      // red run. The ONLY difference between the two cases is whether this box's
      // `strictObject` hands the built shape its declaration's error map.
      keepErrorMaps();

      const { status, output } = runBox(['--check']);

      expect(output).toContain('carry their own proof (#4650)');
      expect(output).toMatch(
        new RegExp(
          `${DELETED_SERVER_TWIN.replace(/[/$]/g, '\\$&')} — def .*; writing '${TWIN_LEAF}' on it is ` +
            `REFUSED as an unrecognized key`,
        ),
      );
      expect(output).toContain('carries the prescription its `strictObject` declaration owes');
      expect(output).not.toContain('authorable baseline line(s) were deleted without proof (#4650)');
      expect(status).toBe(0);

      expect(shardBytes(boxSurfaceDir)).toBe(canonicalBoxSurface);
    },
  );
});
