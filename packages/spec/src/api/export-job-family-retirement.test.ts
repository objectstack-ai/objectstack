// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  EXPORT_ENTRY_POINTS,
  exportNamesOf,
  holdersOf,
} from '../../scripts/lib/export-origins-testkit';
import { CONVERSIONS_BY_MAJOR } from '../conversions/registry';
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR } from '../migrations/registry';

// ─── [#17158] the export-job API family and `ScheduleState` are RETIRED WHOLE ──
//
// ADR-0049 enforce-or-remove. Maintainer ruling A (decision batch #122 item 3):
// the export-job family in `api/export.zod.ts`, `IExportService`
// (`contracts/export-service.ts`) and `ScheduleExportInput` leave the public
// surface, and `ScheduleState` (`automation/execution.zod.ts`) goes with them
// unless a live consumer is measured. Landing route A (decision batch #221
// item 2): objectui retired its side first (objectui#10247, merged as
// objectui PR #10264), and the pinned `.objectui-sha` already descends from that merge.
// Scope note: the export-job LIST pair (`ListExportJobsRequestSchema` with its
// `limit` / `cursor`, and its response) is in, absorbing #19543 door ②; the
// import-job family in the same module is served and is NOT in.
//
// The measurement that decided it, re-taken at this change's base with a lit
// control beside every zero:
//
//   1. objectstack — no code outside `packages/spec` names any of the
//      forty-three exported names (control `ImportJobProgress`: 7 files).
//   2. objectui at the pinned sha — zero non-markdown files name any of them;
//      the only hits are CHANGELOG prose recording objectui#10247 (controls
//      `ImportJobProgress` 7 files, `GetMetaItemLayeredResponseSchema` 9).
//   3. cloud main — zero files (control `@objectstack/spec`: 537 files).
//   4. DOORS — `@objectstack/rest` mounts no `/api/v1/data/export` route and
//      only the `GET` on `/api/v1/data/:object/export` (the synchronous
//      streaming export, which stays); nothing ever bound `IExportService`.
//
// ## Why route 3, and why there is nothing to tombstone
//
// The retired shapes are HTTP bodies, a route map, a service interface and an
// unpersisted runtime record. None is a stack collection or a metadata type, so
// there is no carrier key for a `retiredKey()` tombstone and no authored
// document for an ADR-0087 D2 conversion to rewrite. The declared record is the
// D3 `SemanticMigration` `export-job-family-retired` plus the thirteen
// `RETIRED_DEFS_BY_MAJOR[18]` entries the manifest-deletion gate reads.
//
// Form follows `system/compliance-families-retirement.test.ts` (#15513):
// resolved symbol identity over every public entry via the build-time
// `export-origins/` artifact, the file-deletion probe, the in-package importer
// walk, the runtime-namespace cross-check, the generated-shard absences, the
// registration, and the tree-scoped absence leg whose walk radius is already
// declared for `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs`.

/** The forty-three names the retirement removed from the public surface. */
const RETIRED_NAMES = [
  // api/export.zod.ts — 12 defs, 32 names, plus the route map
  'ExportJobStatus',
  'CreateExportJobRequestSchema', 'CreateExportJobRequest', 'CreateExportJobRequestParsed',
  'CreateExportJobResponseSchema', 'CreateExportJobResponse', 'CreateExportJobResponseParsed',
  'ExportJobProgressSchema', 'ExportJobProgress', 'ExportJobProgressParsed',
  'ScheduledExportSchema', 'ScheduledExport', 'ScheduledExportParsed',
  'GetExportJobDownloadRequestSchema', 'GetExportJobDownloadRequest',
  'GetExportJobDownloadResponseSchema', 'GetExportJobDownloadResponse', 'GetExportJobDownloadResponseParsed',
  'ListExportJobsRequestSchema', 'ListExportJobsRequest', 'ListExportJobsRequestParsed',
  'ExportJobSummarySchema', 'ExportJobSummary',
  'ListExportJobsResponseSchema', 'ListExportJobsResponse', 'ListExportJobsResponseParsed',
  'ScheduleExportRequestSchema', 'ScheduleExportRequest', 'ScheduleExportRequestParsed',
  'ScheduleExportResponseSchema', 'ScheduleExportResponse', 'ScheduleExportResponseParsed',
  'ExportApiContracts',
  // contracts/export-service.ts — the interface and its six types
  'IExportService', 'CreateExportJobInput', 'CreateExportJobResult', 'ExportJobDownload',
  'ListExportJobsOptions', 'ExportJobListResult', 'ScheduleExportInput',
  // automation/execution.zod.ts
  'ScheduleStateSchema', 'ScheduleState', 'ScheduleStateParsed',
] as const;

/** The thirteen def keys, spelled as `json-schema.manifest/` and the registry spell them. */
const RETIRED_DEFS = [
  'api/CreateExportJobRequest', 'api/CreateExportJobResponse', 'api/ExportJobProgress',
  'api/ExportJobStatus', 'api/ExportJobSummary', 'api/GetExportJobDownloadRequest',
  'api/GetExportJobDownloadResponse', 'api/ListExportJobsRequest', 'api/ListExportJobsResponse',
  'api/ScheduleExportRequest', 'api/ScheduleExportResponse', 'api/ScheduledExport',
  'automation/ScheduleState',
] as const;

const SEMANTIC_ID = 'export-job-family-retired';

/** Same-module neighbours that stay — the served import-job family, and the template shape with its format enum. */
const MUST_SURVIVE_API = [
  'ExportFormat', 'ExportImportTemplateSchema', 'ImportJobStatus', 'ImportJobProgressSchema',
  'ListImportJobsRequestSchema', 'ListImportJobsResponseSchema', 'ImportJobApiContracts',
] as const;
const MUST_SURVIVE_AUTOMATION = ['ExecutionLogSchema', 'FlowRunSummarySchema', 'ConcurrencyPolicySchema'] as const;
const MUST_SURVIVE_CONTRACTS = ['IAutomationService', 'RunListResult'] as const;

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_ROOT = path.join(SPEC_ROOT, 'src');

describe('export-job family retirement — the public surface', () => {
  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    for (const needed of ['.', './api', './contracts', './automation']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./api').length, './api must export a non-trivial surface').toBeGreaterThan(100);

    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after the export-job family retirement`).toEqual([]);
    }
    const survivors: Array<[string, readonly string[]]> = [
      ['./api', MUST_SURVIVE_API],
      ['./automation', MUST_SURVIVE_AUTOMATION],
      ['./contracts', MUST_SURVIVE_CONTRACTS],
    ];
    for (const [entry, names] of survivors) {
      const exported = exportNamesOf(entry);
      for (const name of names) expect(exported, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('runtime namespaces agree with the compiler view', async () => {
    const api = await import('./index');
    const automation = await import('../automation/index');
    for (const name of RETIRED_NAMES.filter((n) => n.endsWith('Schema') || n === 'ExportJobStatus' || n === 'ExportApiContracts')) {
      expect(name in api, `api must not export ${name}`).toBe(false);
      expect(name in automation, `automation must not export ${name}`).toBe(false);
    }
    for (const name of MUST_SURVIVE_API) expect(name in api, `${name} must SURVIVE at runtime`).toBe(true);
    for (const name of MUST_SURVIVE_AUTOMATION) expect(name in automation, `${name} must SURVIVE at runtime`).toBe(true);
  });

  it('the service contract module is gone from disk, and nothing in the package imports it any more', () => {
    for (const f of ['export-service.ts', 'export-service.test.ts']) {
      expect(fs.existsSync(path.join(SRC_ROOT, 'contracts', f)), `contracts/${f} must be deleted`).toBe(false);
    }
    // Anti-vacuity: the kept module and a kept sibling prove the probe looks in the right place.
    expect(fs.existsSync(path.join(SRC_ROOT, 'api', 'export.zod.ts'))).toBe(true);
    expect(fs.existsSync(path.join(SRC_ROOT, 'contracts', 'automation-service.ts'))).toBe(true);

    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/(?:import|export)[^;]*['"][^'"]*\/export-service(?:\.js)?['"]/.test(src)) {
            importers.push(path.relative(SRC_ROOT, full));
          }
        }
      }
    };
    walk(SRC_ROOT);
    expect(importers, 'a resurrected import means the retirement is being undone — nothing served, bound or consumed the family').toEqual([]);
  });

  it('the generated shards no longer list any of the thirteen defs or forty-three names', () => {
    const shard = (dir: string, category: string) =>
      fs.readFileSync(path.join(SPEC_ROOT, dir, `${category}.json`), 'utf-8');
    const manifest = (category: string) => (JSON.parse(shard('json-schema.manifest', category)) as { schemas: string[] }).schemas;
    const listed = [...manifest('api'), ...manifest('automation')];
    for (const def of RETIRED_DEFS) {
      expect(listed, `${def} must have left json-schema.manifest/`).not.toContain(def);
    }
    // Anti-vacuity: surviving neighbours are still there.
    expect(listed).toContain('api/ExportFormat');
    expect(listed).toContain('api/ImportJobStatus');
    expect(listed).toContain('automation/ExecutionLog');

    // Word-bounded rather than quoted: the three shards spell a row three ways
    // (`"Name (kind)"`, `"Name": "…"`, a nested origin record), and a retired
    // name must be absent under every spelling.
    const exact = (name: string) => new RegExp(`\\b${name}\\b`);
    const controls: Record<string, string> = { api: 'ImportJobStatus', contracts: 'IAutomationService', automation: 'ExecutionLogSchema' };
    for (const dir of ['api-surface', 'declaration-map', 'export-origins']) {
      for (const category of ['api', 'contracts', 'automation']) {
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
      const text = shard(dir, 'api') + shard(dir, 'automation');
      for (const def of RETIRED_DEFS) {
        expect(text, `${dir}/ must carry no row under ${def}`).not.toMatch(new RegExp(`"${def}:`));
      }
      expect(text, `${dir}/ anti-vacuity`).toMatch(/"api\/ImportRequest:/);
    }
  });
});

describe('ADR-0087 registration', () => {
  it('declares all thirteen defs under major 18, with the D3 semantic entry wired and no D2 conversion', () => {
    for (const def of RETIRED_DEFS) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    const entry = step!.semantic.find((s) => s.id === SEMANTIC_ID);
    expect(entry, `${SEMANTIC_ID} must be wired into the step-18 chain`).toBeDefined();
    expect(entry!.reason.length).toBeGreaterThan(0);
    expect(entry!.acceptanceCriteria.length).toBeGreaterThan(0);
    // The route is stated where the next reader looks: why D3 semantic and not D2.
    expect(entry!.reason).toMatch(/not a D2 conversion/);
    // No backticks in `surface`: the upgrade guide renders it inside a code span AND a table cell.
    expect(entry!.surface).not.toMatch(/`/);
    // The surface names every def and the three retired surfaces beside them.
    for (const def of RETIRED_DEFS) expect(entry!.surface, `surface must name ${def}`).toContain(def);
    for (const name of ['ExportApiContracts', 'IExportService', 'ScheduleExportInput', 'ScheduleStateSchema']) {
      expect(entry!.surface, `surface must name ${name}`).toContain(name);
    }
    // The served import-job family is named as NOT retired, so no sweep takes it.
    expect(entry!.replacement).toMatch(/import-job family .* is served and is NOT part of this retirement/s);

    // Deliberately no mechanical conversion: a transform over a stack that
    // never carries these shapes would be a seam that never runs.
    const conversionIds = Object.values(CONVERSIONS_BY_MAJOR).flatMap((entries) => entries.map((c) => c.id));
    expect(conversionIds.filter((id) => /export-job|schedule-state|scheduled-export/.test(id))).toEqual([]);
    expect(step!.conversionIds.filter((id) => /export-job|schedule-state|scheduled-export/.test(id))).toEqual([]);
    // Lit control: the conversion table is loaded and readable.
    expect(conversionIds.length).toBeGreaterThan(10);
  });
});

// ─── Tree-scoped absence, inside the radius already declared ─────────────────
//
// The walk below reads the five repo roots `system/compliance-families-retirement.test.ts`
// reads — `packages`, `examples`, `skills`, `content`, `scripts` — with the
// same per-root extension sets, and every one of those globs is already
// declared for `@objectstack/spec` in `scripts/cross-package-test-inputs.mjs`
// and mirrored in `turbo.json`, so a resurrection inside the radius puts this
// suite into `turbo ls --affected` and moves the `test:repo` task's cache key.
// This file is listed in `vitest.repo-tests.json` for the same reason.
//
// The bound, stated: `docs/**`, `.claude/**`, `.github/**` and the repo-root
// files are outside the walk (prose-only for these names); `.tsx` under
// `packages/` and every code file under `examples/` are not scanned, because a
// typed import of a retired name fails `tsc` in its own package — the enforced
// channel there. The residue this leg covers is what `tsc` does not compile:
// JSON, YAML, MD, MDX and untyped `.js` / `.mjs` / `.cjs`.
describe('tree-scoped absence: nothing inside the declared radius references a retired name', () => {
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Build, SCM and cache state — not authored sources. */
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const NAME = new RegExp('\\b(' + RETIRED_NAMES.join('|') + ')\\b');
  /** A reference, never a prose mention: an import/export specifier, a type position, a method call, a manifest def key. */
  const REFERENCE = new RegExp(
    '(?:' +
      '[{,]\\s*(?:type\\s+)?' + NAME.source + '\\s*[,}]' +
      '|' +
      '(?:typeof\\s+|:\\s*|<)' + NAME.source + '\\b' +
      '|' +
      NAME.source + '\\.\\w+\\(' +
      '|' +
      '"(?:' + RETIRED_DEFS.join('|') + ')"' +
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
    // `gen:schema`'s gitignored per-def output (`.gitignore`: packages/spec/json-schema/),
    // which a local tree may still hold from a build before this retirement.
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
    expect(REFERENCE.test("import { ExportJobStatus } from '@objectstack/spec/api';")).toBe(true);
    expect(REFERENCE.test("import type { CreateExportJobInput } from '@objectstack/spec/contracts';")).toBe(true);
    expect(REFERENCE.test('const s: ScheduleState = {};')).toBe(true);
    expect(REFERENCE.test('ScheduledExportSchema.parse(value)')).toBe(true);
    expect(REFERENCE.test('typeof ListExportJobsRequestSchema')).toBe(true);
    expect(REFERENCE.test('"api/ExportJobSummary",')).toBe(true);
    expect(REFERENCE.test('"automation/ScheduleState",')).toBe(true);
    expect(REFERENCE.test('the `IExportService` contract was removed')).toBe(false);
    // The served neighbours are not matched.
    expect(REFERENCE.test("import { ImportJobStatus, ListImportJobsRequestSchema } from './export.zod';")).toBe(false);
    expect(REFERENCE.test('"api/ImportJobSummary",')).toBe(false);
    expect(REFERENCE.test('const f: ExportFormat = "csv";')).toBe(false);
  });

  it('no reference survives inside the declared radius outside the retirement kit', () => {
    const offenders: string[] = [];
    let visited = 0;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        if (entry.isDirectory()) {
          if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!(rel.startsWith('examples/') ? EXAMPLES_EXT : SCANNED_EXT).has(ext)) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(entry.name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        const m = REFERENCE.exec(text);
        if (m) offenders.push(`${rel} references \`${m[0].trim()}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'a reference to a retired name means the retirement is being undone — nothing served, bound or consumed the family').toEqual([]);
  });
});
