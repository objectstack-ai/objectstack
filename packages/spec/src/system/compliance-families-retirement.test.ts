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
import { MIGRATIONS_BY_MAJOR, RETIRED_DEFS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

// ─── [#15513] the incident-response, training and change-management families are RETIRED WHOLE ──
//
// ADR-0049 enforce-or-remove; maintainer ruling 2026-09-05 (ruled A: retire the
// three compliance-shaped families whole via RETIRED_DEFS_BY_MAJOR, the
// `integration/ErrorMappingConfig` precedent; none of the three is roadmapped).
// `system/incident-response.zod.ts`, `system/training.zod.ts` and
// `system/change-management.zod.ts` are deleted whole — nineteen emitted defs,
// forty-five exported names, reference docs with them.
//
// The measurement that decided it (the #15513 card at a06faebbe / 83a3353e3,
// triage at f1d7872, re-taken on this branch's base with a lit control in the
// same run):
//
//   1. STATIC — zero readers of any of the forty-five exported names in
//      `packages/**` outside `packages/spec` (tests and changelogs excluded),
//      in `examples/**` and `skills/**`, and in objectui at the pinned sha,
//      while the corpus-reach control (`ObjectSchema` / `FieldSchema` under
//      identical exclusions) returns hundreds of hits. The one word-bounded hit
//      for the bare `Incident` is the English word inside a showcase flow's
//      notify-message string, not a reader of the type.
//   2. DOORS — no `stack.zod.ts` key mounts any of the schemas and
//      `DEFAULT_METADATA_TYPE_REGISTRY` has no type for any of them, so no
//      authoring path — file, REST or stored row — ever reached a parse.
//   3. The compliance face: `IncidentNotificationRule.notifyRegulators`,
//      `IncidentResponsePolicy.requirePostIncidentReview`,
//      `TrainingCourse.mandatory`, `TrainingPlan.trackCompletion` /
//      `sendReminders`, `ChangeRequest.approval.required` and
//      `ChangeRequest.securityImpact.requiresSecurityApproval` were boolean
//      capability claims of exactly the shape ADR-0049 names — an author (very
//      often an AI, ADR-0033) writing `notifyRegulators: true` held a compliance
//      promise the platform never kept, with no error and no feedback.
//
// ## Why route 3, and why there is nothing to tombstone
//
// With no carrier key there is no shape on which a `retiredKey()` tombstone
// could sit, and no author document for an ADR-0087 D2 conversion to rewrite —
// a prescription nobody can receive is noise. The declared record is the three
// D3 `SemanticMigration`s (one per family) plus the nineteen
// `RETIRED_DEFS_BY_MAJOR[18]` entries the manifest-deletion gate reads.
//
// ## What happened to the #14477 deadline-key retirement (PR #15514)
//
// The fourteen `retiredKey()` tombstones that PR planted inside these defs
// leave with their defs' source, and `deadline-keys-retirement.test.ts` — whose
// every pin needed the schemas to exist — is replaced by this file. Its
// fourteen `RETIRED_KEYS_BY_MAJOR[18]` entries and three D3 entries are
// HISTORY and stay: gate (b2) of `scripts/build-schemas.ts` accepts an entry
// naming a key the build no longer emits, and the upgrade guide still owes the
// 17→18 reader the deadline-key prescriptions. Pinned below so nobody "cleans
// them up" as dead registrations.
//
// Form follows #8075 (`message-queue-retirement.test.ts`): resolved symbol
// identity over every public entry via the build-time `export-origins/`
// artifact, the file-deletion probe, the in-package importer walk and the
// runtime-namespace cross-check — plus the tree-scoped absence leg the ruling
// asks for, with its walk radius DECLARED (the playbook rule that landed after
// PR #15514: `scripts/cross-package-test-inputs.mjs`, `turbo.json`).

/** The 45 names the nineteen retired defs exported (19 schema consts + 26 type aliases). */
const RETIRED_NAMES = [
  // incident-response.zod.ts — 8 defs, 19 names
  'IncidentSeveritySchema', 'IncidentSeverity',
  'IncidentCategorySchema', 'IncidentCategory',
  'IncidentStatusSchema', 'IncidentStatus',
  'IncidentResponsePhaseSchema', 'IncidentResponsePhase',
  'IncidentNotificationRuleSchema', 'IncidentNotificationRule', 'IncidentNotificationRuleParsed',
  'IncidentNotificationMatrixSchema', 'IncidentNotificationMatrix', 'IncidentNotificationMatrixParsed',
  'IncidentSchema', 'Incident',
  'IncidentResponsePolicySchema', 'IncidentResponsePolicy', 'IncidentResponsePolicyParsed',
  // training.zod.ts — 5 defs, 12 names
  'TrainingCategorySchema', 'TrainingCategory',
  'TrainingCompletionStatusSchema', 'TrainingCompletionStatus',
  'TrainingCourseSchema', 'TrainingCourse', 'TrainingCourseParsed',
  'TrainingRecordSchema', 'TrainingRecord',
  'TrainingPlanSchema', 'TrainingPlan', 'TrainingPlanParsed',
  // change-management.zod.ts — 6 defs, 14 names
  'ChangeTypeSchema', 'ChangeType',
  'ChangePrioritySchema', 'ChangePriority',
  'ChangeStatusSchema', 'ChangeStatus',
  'ChangeImpactSchema', 'ChangeImpact',
  'RollbackPlanSchema', 'RollbackPlan',
  'ChangeRequestSchema', 'ChangeRequest', 'ChangeRequestParsed',
] as const;

/** The nineteen def keys, spelled as `json-schema.manifest/system.json` and the registry spell them. */
const RETIRED_DEFS = [
  'system/Incident', 'system/IncidentCategory', 'system/IncidentNotificationMatrix',
  'system/IncidentNotificationRule', 'system/IncidentResponsePhase', 'system/IncidentResponsePolicy',
  'system/IncidentSeverity', 'system/IncidentStatus',
  'system/TrainingCategory', 'system/TrainingCompletionStatus', 'system/TrainingCourse',
  'system/TrainingPlan', 'system/TrainingRecord',
  'system/ChangeImpact', 'system/ChangePriority', 'system/ChangeRequest', 'system/ChangeStatus',
  'system/ChangeType', 'system/RollbackPlan',
] as const;

const SEMANTIC_IDS = [
  'incident-response-family-retired',
  'training-family-retired',
  'change-management-family-retired',
] as const;

/** PR #15514's registrations — history, deliberately kept (see the header). */
const HISTORY_KEYS = [
  'system/IncidentResponsePhase:targetHours',
  'system/IncidentNotificationRule:withinMinutes',
  'system/IncidentNotificationRule:regulatorDeadlineHours',
  'system/IncidentNotificationMatrix:escalationTimeoutMinutes',
  'system/IncidentResponsePolicy:triageDeadlineHours',
  'system/IncidentResponsePolicy:retentionDays',
  'system/TrainingCourse:durationMinutes',
  'system/TrainingCourse:validityDays',
  'system/TrainingPlan:recertificationIntervalDays',
  'system/TrainingPlan:gracePeriodDays',
  'system/TrainingPlan:reminderDaysBefore',
  'system/ChangeImpact:downtime.durationMinutes',
  'system/RollbackPlan:steps.estimatedMinutes',
  'system/ChangeRequest:implementation.steps.estimatedMinutes',
] as const;
const HISTORY_SEMANTIC_IDS = [
  'incident-response-deadline-keys-retired',
  'training-deadline-keys-retired',
  'change-management-duration-keys-retired',
] as const;

/**
 * The near-namesakes a "finish everything incident / change" sweep would
 * plausibly take, each a DIFFERENT declaration with a live consumer.
 */
const MUST_SURVIVE_KERNEL = ['MetadataChangeTypeSchema', 'MetadataChangeType'] as const;
/** System-entry neighbours that stay — the ones the retired files imported from. */
const MUST_SURVIVE_SYSTEM = ['DataClassificationSchema', 'ComplianceFrameworkSchema', 'ChangeSetSchema'] as const;

const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC_ROOT = path.join(SPEC_ROOT, 'src');

describe('[#15513] system/ compliance families retirement — the public surface', () => {
  it('every retired name has ZERO holders on any public entry; the survivors still stand', () => {
    for (const needed of ['.', './system', './kernel']) {
      expect(EXPORT_ENTRY_POINTS, `exports map must include ${needed}`).toContain(needed);
    }
    expect(exportNamesOf('./system').length, './system must export a non-trivial surface').toBeGreaterThan(100);

    for (const name of RETIRED_NAMES) {
      expect(holdersOf(name), `${name} must have zero holders after #15513`).toEqual([]);
    }
    const systemNames = exportNamesOf('./system');
    for (const name of MUST_SURVIVE_SYSTEM) {
      expect(systemNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
    const kernelNames = exportNamesOf('./kernel');
    for (const name of MUST_SURVIVE_KERNEL) {
      expect(kernelNames, `${name} must SURVIVE this retirement`).toContain(name);
    }
  });

  it('runtime namespace agrees with the compiler view', async () => {
    const system = await import('./index');
    for (const name of RETIRED_NAMES.filter((n) => n.endsWith('Schema'))) {
      expect(name in system, `system must not export ${name}`).toBe(false);
    }
    for (const name of MUST_SURVIVE_SYSTEM) {
      expect(name in system, `${name} must SURVIVE at runtime`).toBe(true);
    }
  });

  it('the three modules are gone from disk, and nothing in the package imports them any more', () => {
    for (const f of [
      'incident-response.zod.ts', 'incident-response.test.ts',
      'training.zod.ts', 'training.test.ts',
      'change-management.zod.ts', 'change-management.test.ts',
      'deadline-keys-retirement.test.ts',
    ]) {
      expect(fs.existsSync(path.join(SRC_ROOT, 'system', f)), `system/${f} must be deleted`).toBe(false);
    }
    // Anti-vacuity: a kept sibling proves the probe looks in the right place.
    expect(fs.existsSync(path.join(SRC_ROOT, 'system', 'security-context.zod.ts'))).toBe(true);

    const importers: string[] = [];
    const self = fileURLToPath(import.meta.url);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        // This file quotes a resurrected import as its matcher's anti-vacuity
        // fixture below, so it is the one file the importer walk must skip.
        else if (entry.name.endsWith('.ts') && full !== self) {
          const src = fs.readFileSync(full, 'utf-8');
          if (/(?:import|export)[^;]*['"][^'"]*\/(?:incident-response|training|change-management)\.zod(?:\.js)?['"]/.test(src)) {
            importers.push(path.relative(SRC_ROOT, full));
          }
        }
      }
    };
    walk(SRC_ROOT);
    expect(importers, 'a resurrected import means the retirement is being undone — re-read #15513').toEqual([]);
  });

  it('the generated shards no longer list any of the nineteen defs or forty-five names', () => {
    const shard = (dir: string) => fs.readFileSync(path.join(SPEC_ROOT, dir, 'system.json'), 'utf-8');
    const manifest = JSON.parse(shard('json-schema.manifest')) as { schemas: string[] };
    for (const def of RETIRED_DEFS) {
      expect(manifest.schemas, `${def} must have left json-schema.manifest/`).not.toContain(def);
    }
    // Anti-vacuity: a surviving neighbour is still there.
    expect(manifest.schemas).toContain('system/ChangeSet');
    // Word-bounded rather than quoted: the three shards spell a row three ways
    // (`"Name (kind)"`, `"Name": "…"`, a nested origin record), and a retired
    // name must be absent under every spelling.
    const exact = (name: string) => new RegExp(`\\b${name}\\b`);
    for (const dir of ['api-surface', 'declaration-map', 'export-origins']) {
      const text = shard(dir);
      for (const name of RETIRED_NAMES) {
        expect(text, `${dir}/system.json must not list ${name}`).not.toMatch(exact(name));
      }
      expect(text, `${dir}/system.json anti-vacuity`).toMatch(exact('DataClassificationSchema'));
    }
    for (const dir of ['authorable-surface', 'authorable-defaults']) {
      const text = shard(dir);
      for (const def of RETIRED_DEFS) {
        expect(text, `${dir}/system.json must carry no row under ${def}`).not.toMatch(new RegExp(`"${def}:`));
      }
    }
  });
});

describe('[#15513] ADR-0087 registration', () => {
  it('declares all nineteen defs under major 18, with the three D3 semantic entries wired and no D2 conversion', () => {
    for (const def of RETIRED_DEFS) {
      expect(RETIRED_DEFS_BY_MAJOR[18], `${def} must be declared`).toContain(def);
    }
    const step = MIGRATIONS_BY_MAJOR[18];
    expect(step).toBeDefined();
    const ids = step!.semantic.map((s) => s.id);
    for (const id of SEMANTIC_IDS) {
      expect(ids, `${id} must be wired into the step-18 chain`).toContain(id);
      const entry = step!.semantic.find((s) => s.id === id)!;
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.acceptanceCriteria.length).toBeGreaterThan(0);
      // The route is stated where the next reader looks: why D3 semantic and
      // not D2 — no stack seam (the additionalTypes precedent).
      expect(entry.reason).toMatch(/not a D2 conversion/);
      // And no backticks in `surface`: the upgrade guide renders it inside a
      // code span AND a table cell.
      expect(entry.surface).not.toMatch(/`/);
    }
    // Deliberately no mechanical conversion: a transform over a stack that
    // never carries these documents would be a seam that never runs.
    expect(step!.conversionIds.filter((id) => /incident|training|change-management|deadline/.test(id))).toEqual([]);
    // The step's own rationale records the family retirement.
    expect(step!.rationale).toMatch(/retires those three compliance-shaped families WHOLE/);
  });

  it("keeps PR #15514's fourteen deadline-key registrations and three D3 entries as history", () => {
    for (const key of HISTORY_KEYS) {
      expect(RETIRED_KEYS_BY_MAJOR[18], `${key} is history — keep it`).toContain(key);
    }
    const ids = MIGRATIONS_BY_MAJOR[18]!.semantic.map((s) => s.id);
    for (const id of HISTORY_SEMANTIC_IDS) {
      expect(ids, `${id} is history — keep it`).toContain(id);
    }
  });
});

// ─── Tree-scoped absence, with a DECLARED radius ─────────────────────────────
//
// What this leg guarantees. The walk below reads six repo roots — `packages`,
// `examples`, `skills`, `content`, `scripts`, `docs` is NOT among them — and
// every root it reads is declared for `@objectstack/spec#test` in
// `scripts/cross-package-test-inputs.mjs` (with this file as the `heldBy`
// witness for the globs no literal path holds) and mirrored in `turbo.json`,
// so a resurrection inside the radius puts this suite into
// `turbo ls --affected` and moves the `test` task's cache key. That is the
// declaration half PR #15514's pin lacked (#15528, closed by the playbook rule
// #15566 added).
//
// The bound, stated: `docs/**` (ADRs, audits), `.claude/**`, `.github/**` and
// the repo-root files are outside the walk. Each is prose-only for these names
// — an ADR that mentions `IncidentResponsePolicySchema` is a mention, not an
// authoring or an import — and `docs/adr/**` and `.claude/**` are governed,
// human-merged surfaces; declaring them would add new top-level roots to
// ci.yml's `crosspkg:` filter for no reachable resurrection. `apps/` holds only
// the Fumadocs site (its content lives under `content/`).
//
// Extensions: `.tsx` is deliberately NOT scanned, and the declared globs under
// `packages/` are spelled per extension so none covers a `.tsx` file — the
// dispatch-gates self-test pins that no cross-package hint reaches
// `packages/client-react`'s `realtime-hooks.test.tsx` (the `@objectstack/core`
// entry records the measurement). A `.tsx` import of a retired name fails
// `tsc` in its own package, which is the enforced channel for typed sources.
// The residue this leg covers is everything `tsc` does not compile: JSON,
// YAML, MD, MDX, and untyped `.js` / `.mjs` / `.cjs`.
describe('[#15513] tree-scoped absence: nothing inside the declared radius references a retired name', () => {
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  /** The walked roots — declared in `scripts/cross-package-test-inputs.mjs` under `@objectstack/spec`. */
  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  /** Per-extension under `packages/` (never `.tsx`, see above); the other roots are declared whole. */
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx', '.yaml', '.yml']);
  /** Build, SCM and cache state — not authored sources. */
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  /**
   * The distinctive names: every `*Schema` const and every multi-word or
   * CamelCase alias. The bare `Incident` is excluded from THIS leg (it is an
   * English word — the showcase's `'Incident push failed'` string is the
   * measured false positive) and judged by the export-origins leg above
   * instead, where the match is an exact symbol.
   */
  const NAME = new RegExp(
    '\\b(' + RETIRED_NAMES.filter((n) => n !== 'Incident').join('|') + ')\\b',
  );
  /** A reference, never a prose mention: an import/export specifier, a member access, a type position, a JSON def key. */
  const REFERENCE = new RegExp(
    '(?:' +
      // `import { X }` / `export { X }` / `, X,` inside a specifier list
      '[{,]\\s*(?:type\\s+)?' + NAME.source + '\\s*[,}]' +
      '|' +
      // `typeof X` / `: X` / `<X>` — a type position
      '(?:typeof\\s+|:\\s*|<)' + NAME.source + '\\b' +
      '|' +
      // `X.parse(` / `X.safeParse(` — a method call on the schema
      NAME.source + '\\.\\w+\\(' +
      '|' +
      // the manifest / registry spelling of the def
      '"system/(?:' + RETIRED_DEFS.map((d) => d.slice('system/'.length)).join('|') + ')"' +
    ')',
  );

  /** Structural exclusions, each with its reason. NOT an allowlist file: these are the retirement kit and its projections. */
  const EXCLUDED = new Set([
    // The survivor note in the barrel names what left.
    'packages/spec/src/system/index.ts',
    // This pin names them to assert their absence.
    THIS_FILE,
  ]);
  const EXCLUDED_PREFIXES = [
    // Registers the retirement by def / key (entries + the generated registry).
    'packages/spec/src/migrations/',
    // Generated projections of the registry.
    'packages/spec/spec-changes.json',
    // Release prose records the removal (release-owned; never edited by a code PR).
    'content/docs/releases/',
    '.changeset/',
  ];

  it('the matcher recognises a reference and ignores a prose mention (anti-vacuity)', () => {
    expect(REFERENCE.test("import { IncidentResponsePolicySchema } from './incident-response.zod';")).toBe(true);
    expect(REFERENCE.test('const x: TrainingCourse = {};')).toBe(true);
    expect(REFERENCE.test('ChangeRequestSchema.parse(value)')).toBe(true);
    expect(REFERENCE.test('typeof ChangeRequestSchema')).toBe(true);
    expect(REFERENCE.test('"system/RollbackPlan",')).toBe(true);
    expect(REFERENCE.test('the `IncidentResponsePolicySchema` export was removed')).toBe(false);
    expect(REFERENCE.test("title: 'Incident push failed: {record.name}'")).toBe(false);
    expect(REFERENCE.test('MetadataChangeTypeSchema')).toBe(false); // the live near-namesake
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
        if (!SCANNED_EXT.has(path.extname(entry.name))) continue;
        if (entry.name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        visited += 1;
        const text = fs.readFileSync(full, 'utf-8');
        const m = REFERENCE.exec(text);
        if (m) offenders.push(`${rel} references \`${m[0].trim()}\``);
      }
    };
    for (const root of WALK_ROOTS) walk(path.join(REPO_ROOT, root));
    // Anti-vacuity: the walk really covered the tree.
    expect(visited).toBeGreaterThan(1000);
    expect(offenders, 'a reference to a retired name means the retirement is being undone — re-read #15513').toEqual([]);
  });
});
