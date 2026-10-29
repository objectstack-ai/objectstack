// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import type { IPackageService } from '../contracts/package-service';
import { PackageUpgradeResponseSchema } from '../api/package-api.zod';
import { CONVERSIONS_BY_MAJOR } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

// ─── [#25608] `kernel/package-upgrade.zod.ts` is RETIRED WHOLE ───────────────
//
// ADR-0049 enforce-or-remove. Maintainer ruling A (`6259332195` on #24443,
// item 3, 「其他同意」): "Retired: packages/spec/src/kernel/package-upgrade.zod.ts
// (plan, diff, conflict, snapshot, rollback; zero runtime consumers), with its
// ADR-0087 conversion." Done directly in 18.x with no retirement stage.
//
// The measurement that decided it, re-taken at this change's base
// (objectstack `47af3dde42`) with a lit control beside every zero:
//
//   1. objectstack — no code outside `packages/spec` names any of the retired
//      names; the only hits are the generated reference pages, one link in
//      `content/docs/upgrading.mdx` and one ADR sentence.
//   2. objectui main `a3c0da9` and the pinned `.objectui-sha` `2958f17e9c` —
//      zero files (control `@objectstack/spec`: 2123 / 2131 files).
//   3. hotcrm `a4b3560` — zero files (control `@objectstack/spec`: 293 files).
//   4. Providers — nothing implements `IPackageService`, so no `planUpgrade`,
//      `upgrade`, `rollback` or `getSnapshot` body ever existed.
//
// ## Why route 3, and why there is nothing to tombstone
//
// The retired shapes are a service's return values and HTTP bodies. None is a
// stack collection or a metadata type, so there is no carrier key for a
// `retiredKey()` tombstone and no authored document for an ADR-0087 D2
// conversion to rewrite. The ruling's "ADR-0087 conversion" is therefore the
// ledger record: the D3 `SemanticMigration` `kernel-package-upgrade-family-retired`
// plus the ten `RETIRED_DEFS_BY_MAJOR[18]` entries the manifest-deletion gate
// reads (the export-job and change-management precedents).
//
// Form follows `api/export-job-family-retirement.test.ts`.

/** Every name the retirement removed from the public surface. */
const RETIRED_NAMES = [
  // kernel/package-upgrade.zod.ts — ten defs
  'MetadataChangeTypeSchema', 'MetadataChangeType',
  'MetadataDiffItemSchema', 'MetadataDiffItem', 'MetadataDiffItemParsed',
  'UpgradeImpactLevelSchema', 'UpgradeImpactLevel',
  'UpgradePlanSchema', 'UpgradePlan', 'UpgradePlanParsed',
  'UpgradeSnapshotSchema', 'UpgradeSnapshot', 'UpgradeSnapshotParsed',
  'UpgradePackageRequestSchema', 'UpgradePackageRequest', 'UpgradePackageRequestParsed',
  'UpgradePhaseSchema', 'UpgradePhase',
  'UpgradePackageResponseSchema', 'UpgradePackageResponse', 'UpgradePackageResponseParsed',
  'RollbackPackageRequestSchema', 'RollbackPackageRequest', 'RollbackPackageRequestParsed',
  'RollbackPackageResponseSchema', 'RollbackPackageResponse',
  // contracts/package-service.ts — the inputs of the four retired members
  'PlanUpgradeInput', 'ExecuteUpgradeInput', 'RollbackInput',
] as const;

/** The ten def keys, spelled as `json-schema.manifest/` and the registry spell them. */
const RETIRED_DEFS = [
  'kernel/MetadataChangeType', 'kernel/MetadataDiffItem', 'kernel/RollbackPackageRequest',
  'kernel/RollbackPackageResponse', 'kernel/UpgradeImpactLevel', 'kernel/UpgradePackageRequest',
  'kernel/UpgradePackageResponse', 'kernel/UpgradePhase', 'kernel/UpgradePlan', 'kernel/UpgradeSnapshot',
] as const;

const SEMANTIC_ID = 'kernel-package-upgrade-family-retired';

/** Same-entry neighbours that stay — the package model the retired file sat beside. */
const MUST_SURVIVE_KERNEL = ['PackageArtifactSchema', 'InstalledPackageSchema', 'ManifestSchema'] as const;
const MUST_SURVIVE_API = ['PackageUpgradeRequestSchema', 'PackageUpgradeResponseSchema', 'RollbackToPackageCommitResponseSchema'] as const;
const MUST_SURVIVE_CONTRACTS = ['IPackageService', 'InstallPackageInput', 'UploadArtifactInput'] as const;

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_ROOT = path.join(SPEC_ROOT, 'src');

describe('package upgrade model retirement — the public surface', () => {
  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    for (const needed of ['.', './kernel', './contracts', './api']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./kernel').length, './kernel must export a non-trivial surface').toBeGreaterThan(100);

    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after the package upgrade retirement`).toEqual([]);
    }
    const survivors: Array<[string, readonly string[]]> = [
      ['./kernel', MUST_SURVIVE_KERNEL],
      ['./api', MUST_SURVIVE_API],
      ['./contracts', MUST_SURVIVE_CONTRACTS],
    ];
    for (const [entry, names] of survivors) {
      const exported = exportNamesOf(entry);
      for (const name of names) expect(exported, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('runtime namespaces agree with the compiler view', async () => {
    const kernel = await import('./index');
    const root = await import('../index');
    for (const name of RETIRED_NAMES.filter((n) => n.endsWith('Schema'))) {
      expect(name in kernel, `kernel must not export ${name}`).toBe(false);
      expect(name in root, `the root entry must not export ${name}`).toBe(false);
    }
    for (const name of MUST_SURVIVE_KERNEL) expect(name in kernel, `${name} must SURVIVE at runtime`).toBe(true);
  });

  it('IPackageService carries none of the four upgrade members; its install surface stands', () => {
    expectTypeOf<'planUpgrade' extends keyof IPackageService ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'upgrade' extends keyof IPackageService ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'rollback' extends keyof IPackageService ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<'getSnapshot' extends keyof IPackageService ? true : false>().toEqualTypeOf<false>();
    // Lit control: the same probe answers true for a member that stays.
    expectTypeOf<'install' extends keyof IPackageService ? true : false>().toEqualTypeOf<true>();
  });

  it('PackageUpgradeResponse.data no longer declares `plan`; its declared siblings stand', () => {
    const data = PackageUpgradeResponseSchema.shape.data;
    expect(Object.keys(data.shape)).not.toContain('plan');
    expect(Object.keys(data.shape)).toEqual(expect.arrayContaining(['success', 'phase', 'snapshotId', 'conflicts']));
  });

  it('the module is gone from disk, and nothing in the package imports it any more', () => {
    for (const f of ['package-upgrade.zod.ts', 'package-upgrade.test.ts']) {
      expect(fs.existsSync(path.join(SRC_ROOT, 'kernel', f)), `kernel/${f} must be deleted`).toBe(false);
    }
    // Anti-vacuity: kept siblings prove the probe looks in the right place.
    expect(fs.existsSync(path.join(SRC_ROOT, 'kernel', 'package-registry.zod.ts'))).toBe(true);
    expect(fs.existsSync(path.join(SRC_ROOT, 'contracts', 'package-service.ts'))).toBe(true);

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // This pin spells the specifier in its matcher fixtures, never as an import.
        else if (entry.name.endsWith('.ts') && full !== fileURLToPath(import.meta.url)) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/(?:import|export)[^;]*['"][^'"]*\/package-upgrade\.zod(?:\.js)?['"]/.test(src)) {
            importers.push(path.relative(SRC_ROOT, full));
          }
        }
      }
    };
    walk(SRC_ROOT);
    expect(importers, 'a resurrected import means the retirement is being undone — nothing implemented or read the model').toEqual([]);
  });

  it('the generated shards no longer list any of the ten defs or the retired names', () => {
    const shard = (dir: string, category: string) =>
      fs.readFileSync(path.join(SPEC_ROOT, dir, `${category}.json`), 'utf-8');
    const listed = (JSON.parse(shard('json-schema.manifest', 'kernel')) as { schemas: string[] }).schemas;
    for (const def of RETIRED_DEFS) {
      expect(listed, `${def} must have left json-schema.manifest/`).not.toContain(def);
    }
    // Anti-vacuity: surviving neighbours are still there.
    expect(listed).toContain('kernel/PackageArtifact');
    expect(listed).toContain('kernel/InstalledPackage');

    // Word-bounded rather than quoted: the shards spell a row several ways.
    const exact = (name: string) => new RegExp(`\\b${name}\\b`);
    const controls: Record<string, string> = { kernel: 'PackageArtifactSchema', contracts: 'IPackageService' };
    for (const dir of ['api-surface', 'declaration-map', 'export-origins']) {
      for (const category of ['kernel', 'contracts']) {
        const file = path.join(SPEC_ROOT, dir, `${category}.json`);
        if (!fs.existsSync(file)) continue; // declaration-map carries no contracts shard
        const text = fs.readFileSync(file, 'utf-8');
        for (const name of RETIRED_NAMES) {
          expect(text, `${dir}/${category}.json must not list ${name}`).not.toMatch(exact(name));
        }
        expect(text, `${dir}/${category}.json anti-vacuity`).toMatch(exact(controls[category]!));
      }
    }
    for (const dir of ['authorable-surface', 'authorable-defaults']) {
      const text = shard(dir, 'kernel');
      for (const def of RETIRED_DEFS) {
        expect(text, `${dir}/ must carry no row under ${def}`).not.toMatch(new RegExp(`"${def}:`));
      }
      expect(text, `${dir}/ anti-vacuity`).toMatch(/"kernel\/PackageArtifact:/);
    }
  });
});

describe('ADR-0087 registration', () => {
  it('declares all ten defs under major 18, with the D3 semantic entry wired and no D2 conversion', () => {
    for (const def of RETIRED_DEFS) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    const entry = step!.semantic.find((s) => s.id === SEMANTIC_ID);
    expect(entry, `${SEMANTIC_ID} must be wired into the step-18 chain`).toBeDefined();
    expect(entry!.reason).toMatch(/ADR-0049/);
    expect(entry!.acceptanceCriteria).toMatch(/TS2305/);
    // The route is stated where the next reader looks: why D3 semantic and not D2.
    expect(entry!.reason).toMatch(/not a D2 conversion/);
    for (const def of RETIRED_DEFS) expect(entry!.surface, `surface must name ${def}`).toContain(def);
    for (const name of ['planUpgrade', 'getSnapshot', 'PlanUpgradeInput', 'PackageUpgradeResponse.data']) {
      expect(entry!.surface, `surface must name ${name}`).toContain(name);
    }
    // The served neighbours are named as what to use, so no sweep takes them.
    expect(entry!.replacement).toMatch(/RollbackToPackageCommitResponseSchema/);
    expect(step!.rationale).toMatch(/retires the package upgrade model WHOLE/);

    // Deliberately no mechanical conversion: a transform over a stack that
    // never carries these shapes would be a seam that never runs.
    const conversionIds = Object.values(CONVERSIONS_BY_MAJOR).flatMap((entries) => entries.map((c) => c.id));
    expect(conversionIds.filter((id) => /package-upgrade|upgrade-plan|upgrade-snapshot/.test(id))).toEqual([]);
    expect(step!.conversionIds.filter((id) => /package-upgrade|upgrade-plan|upgrade-snapshot/.test(id))).toEqual([]);
    // Lit control: the conversion table is loaded and readable.
    expect(conversionIds.length).toBeGreaterThan(10);
  });

  it('the `UpgradePlan.estimatedDuration` tombstone entries stay registered as history', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('kernel/UpgradePlan:estimatedDuration');
    expect(MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id)).toContain('kernel-package-lifecycle-durations-unit-in-key');
  });
});

// ─── Tree-scoped absence, inside the radius already declared ─────────────────
//
// The walk reads the five repo roots `api/export-job-family-retirement.test.ts`
// reads — `packages`, `examples`, `skills`, `content`, `scripts` — with the
// same per-root extension sets; every one of those globs is already declared
// for `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs` and
// mirrored in `turbo.json`, and this file is listed in `vitest.repo-tests.json`.
//
// The bound, stated: `docs/**`, `.claude/**`, `.github/**` and the repo-root
// files are outside the walk (the one ADR sentence naming the file is corrected
// in its own governed PR); `.tsx` under `packages/` and every code file under
// `examples/` are not scanned, because a typed import of a retired name fails
// `tsc` in its own package — the enforced channel there. The residue this leg
// covers is what `tsc` does not compile: JSON, YAML, MD, MDX and untyped
// `.js` / `.mjs` / `.cjs`.
describe('tree-scoped absence: nothing inside the declared radius references a retired name', () => {
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Build, SCM and cache state — not authored sources. */
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const NAME = new RegExp('\\b(' + RETIRED_NAMES.join('|') + ')\\b');
  /**
   * A reference, never a prose mention: an import/export specifier, a type
   * position, a method call, a manifest def key, the module specifier, or the
   * reference page's link.
   */
  const REFERENCE = new RegExp(
    '(?:' +
      '[{,]\\s*(?:type\\s+)?' + NAME.source + '\\s*[,}]' +
      '|' +
      '(?:typeof\\s+|:\\s*|<)' + NAME.source + '\\b' +
      '|' +
      NAME.source + '\\.\\w+\\(' +
      '|' +
      '"(?:' + RETIRED_DEFS.join('|') + ')"' +
      '|' +
      "['\"][^'\"]*/package-upgrade\\.zod(?:\\.js)?['\"]" +
      '|' +
      '/docs/references/kernel/package-upgrade\\b' +
    ')',
  );

  /** Structural exclusions, each with its reason. NOT an allowlist file. */
  const EXCLUDED = new Set([
    // This pin names them to assert their absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Registers the retirement by def (entries + the generated registry).
    'packages/spec/src/migrations/',
    // Generated projection of the registry.
    'packages/spec/spec-changes.json',
    // `gen:schema`'s gitignored per-def output, which a local tree may still
    // hold from a build before this retirement.
    'packages/spec/json-schema/',
    // Written only by `gen:authorable-surface-base` (never a normal build); its
    // `baseRev` is allowed to lag, and `check:authorable-surface` is the gate.
    'packages/spec/authorable-surface.base.json',
    // Release prose records the removal (release-owned; never edited by a code PR).
    'content/docs/releases/',
    '.changeset/',
  ];
  /** tsup's transient config bundle — a copy of `tsup.config.ts`, which the walk already reads. */
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      // A path that vanished mid-walk cannot be a surviving reference; every other fault is re-raised.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises a reference and ignores a prose mention (anti-vacuity)', () => {
    expect(REFERENCE.test("import { UpgradePlanSchema } from '@objectstack/spec/kernel';")).toBe(true);
    expect(REFERENCE.test("import type { PlanUpgradeInput } from '@objectstack/spec/contracts';")).toBe(true);
    expect(REFERENCE.test('const s: UpgradeSnapshot = {};')).toBe(true);
    expect(REFERENCE.test('RollbackPackageRequestSchema.parse(value)')).toBe(true);
    expect(REFERENCE.test('"kernel/UpgradePhase",')).toBe(true);
    expect(REFERENCE.test("export * from './package-upgrade.zod';")).toBe(true);
    expect(REFERENCE.test('see the [protocol](/docs/references/kernel/package-upgrade).')).toBe(true);
    expect(REFERENCE.test('the `UpgradePlanSchema` export was removed')).toBe(false);
    // The surviving neighbours are not matched.
    expect(REFERENCE.test("import { PackageUpgradeRequestSchema, PackageUpgradeResponseSchema } from './package-api.zod';")).toBe(false);
    expect(REFERENCE.test('const r: RollbackToPackageCommitResponse = x;')).toBe(false);
    expect(REFERENCE.test('"kernel/PackageArtifact",')).toBe(false);
  });

  it('no reference survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    // What git does not ignore, never the raw filesystem (`scripts/lib/repo-walk-testkit.ts`).
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(path.extname(name))) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = REFERENCE.exec(text);
        if (m) offenders.push(`${rel} references \`${m[0].trim()}\``);
      }
    }
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'a reference to a retired name means the retirement is being undone — nothing implemented or read the model').toEqual([]);
  });
});
