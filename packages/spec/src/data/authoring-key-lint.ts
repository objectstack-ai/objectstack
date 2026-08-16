// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Unknown authoring keys, reported instead of swallowed** (#3786).
 *
 * `ObjectSchema` and `FieldSchema` are deliberately not `.strict()`, so a key
 * they do not declare parses clean and is **stripped on the way to storage**.
 * The author gets no error; the capability they thought they configured simply
 * is not there. That is the ADR-0104 failure class the `FieldSchema` prune
 * tombstone already describes in prose, and #4120 found five live instances of
 * it inside this very package — a `pii` toggle, an `indexed` toggle and a
 * `cascadeDelete` select that had been rendering in Studio for releases while
 * saving nothing.
 *
 * ## Why a lint and not `.strict()`
 *
 * Making these two schemas strict is the eventual destination — it is the
 * enforce side of ADR-0049 and the tier programme #4001 started on the flow and
 * permission schemas. But `object` and `field` are the two most-authored
 * surfaces in the protocol, so flipping them rejects metadata that parses today:
 * a migration event for every consumer, and one that should be scheduled on
 * evidence rather than guessed at. This rule produces that evidence while
 * costing nobody a migration — it reports, it never rejects.
 *
 * ## Why it lives in `@objectstack/spec` and not `@objectstack/lint`
 *
 * `@objectstack/lint`'s rules are `(stack) => Finding[]` over a **schema-parsed**
 * stack. By then the unknown keys are gone — the parse is what ate them. This
 * has to run **pre-parse**, on the authored input, which is the same seam the
 * ADR-0087 D2 conversion notices already use in `defineStack`.
 *
 * ## Why this file is only the CORE
 *
 * This module carries the comparator, the finding shape and the curated guidance
 * tables — deliberately nothing heavier. The stack WALKER
 * (`lintUnknownAuthoringKeys`) lives in `kernel/metadata-authoring-lint.ts`,
 * because covering every metadata type means importing every schema, and this
 * file is re-exported from the `/data` subpath that frontend bundles consume
 * (objectui reads `REFERENCE_VALUE_TYPES` and friends from it). Pulling the
 * whole schema universe into that chunk to run a build-time lint would be its
 * own regression. The kernel already is the everything-imports zone.
 *
 * @see ADR-0049 enforce-or-remove · ADR-0104 · #4001 (the strict tiers)
 */

import { findClosestMatches } from '../shared/suggestions.zod';

/**
 * Which authoring surface a finding came from — a metadata type machine name
 * (`'object'`, `'page'`, `'agent'`, …) or `'field'` for the one nested surface
 * the walker descends into (an object's `fields` record).
 */
export type AuthoringKeySurface = string;

/** One unknown key on one authored object or field. */
export interface UnknownAuthoringKeyFinding {
  /** Dotted path to the offending key, e.g. `objects.crm_case.fields.owner.pii`. */
  path: string;
  surface: AuthoringKeySurface;
  /** The key the schema does not declare. */
  key: string;
  /**
   * The canonical key this is a recognisable spelling of, when one is known.
   * Comes from {@link FIELD_KEY_GUIDANCE} / {@link OBJECT_KEY_GUIDANCE} first,
   * then from an edit-distance match against the declared keys.
   */
  suggestion?: string;
  /**
   * Prescriptive sentence for a key that was RETIRED rather than renamed —
   * where "did you mean X" would be wrong because there is no X.
   */
  guidance?: string;
}

/**
 * Semantic near-misses on `FieldSchema` — a different **word** for the same
 * intent, or a key that was retired outright.
 *
 * Every entry here was found in the wild. The rename half is what `object.form.ts`
 * had drifted into by #4120; the retired half is the `auditTrail` / `dataQuality`
 * / `encryptionConfig` family pruned in 2026-06 plus the field-level `index` flag
 * removed in the 16.x line (#2377). Edit distance cannot reach most of these
 * (`cascadeDelete` → `deleteBehavior` is 11 apart), which is exactly why they are
 * named rather than left to the fallback.
 *
 * A `to` names a declared `FieldSchema` key; a `why` marks a retirement with no
 * successor. `authoring-key-lint.test.ts` asserts every `to` really is declared,
 * so this table cannot rot into advice pointing at keys that no longer exist.
 */
export const FIELD_KEY_GUIDANCE: Readonly<
  Record<string, { to?: string; why?: string }>
> = Object.freeze({
  // ── Renamed: the concept survives under a different key ──
  referenceFilter: { to: 'lookupFilters' },
  cascadeDelete: { to: 'deleteBehavior' },
  formula: { to: 'expression' },
  displayFormat: { to: 'autonumberFormat' },
  summaryType: { to: 'summaryOperations' },
  summaryField: { to: 'summaryOperations' },
  // NOTE: no entry for `conditionalRequired`. It was removed as an alias in
  // protocol 17 (#3855) but is still DECLARED on FieldSchema as a `retiredKey()`
  // tombstone, so the schema rejects it with its own prescription. An entry here
  // would be dead weight the lint never reaches — the test below enforces that.
  index: { why: 'field-level index flags built no index and were removed in the 16.x line (#2377, ADR-0049) — declare the index in the object\'s `indexes[]` instead.' },

  // ── Retired: no successor key ──
  indexed: { why: 'never a FieldSchema key; a field-level index flag built no index (#2377). Declare the index in the object\'s `indexes[]`.' },
  immutable: { why: 'never a FieldSchema key. Use the `readonlyWhen` predicate to lock a field after creation.' },
  filterable: { why: 'never a FieldSchema key — every declared column is filterable. `sortable` and `searchable` are the real knobs.' },
  placeholder: { why: 'never a FieldSchema key. Author hint text through `inlineHelpText` or `description`.' },
  startingNumber: { why: 'never a FieldSchema key. An autonumber counter resets per rendered prefix, which `autonumberFormat` itself determines.' },
  validation: { why: 'field-level predicates are not a FieldSchema key — author a `validation` metadata item on the object, which carries its own message.' },
  errorMessage: { why: 'pairs with the `validation` key that never existed; a `validation` metadata item carries its own message.' },
  audit: { why: 'the `auditTrail` family was pruned in 2026-06 as dead in both layers. Use `trackHistory` for the activity timeline.' },
  auditTrail: { why: 'pruned in 2026-06 as dead in both layers. Use `trackHistory` for the activity timeline.' },
  pii: { why: 'the `dataQuality` governance family was pruned in 2026-06 as dead in both layers — it enforced nothing.' },
  dataQuality: { why: 'pruned in 2026-06 as dead in both layers (#3726) — it enforced nothing.' },
  encrypted: { why: 'the `encryptionConfig` family was pruned in 2026-06: it implied at-rest protection that never happened. The real channel is `type: \'secret\'`.' },
  encryptionConfig: { why: 'pruned in 2026-06 — it implied at-rest protection that never happened. The real channel is `type: \'secret\'`.' },
  // NOTE: no entry for `maskingRule`. It sat here as a retirement ("pruned in
  // 2026-06 as dead in both layers — masking was never applied") until the
  // 2026-08-16 maintainer ruling on #8993 re-introduced the key WITH its
  // runtime consumer (plugin-security's FieldMasker applies partial masking on
  // the read/export path), so `FieldSchema` now declares it and an entry here
  // would be advice to delete a live key — the "no guidance entry names a key
  // the schema now declares" test enforces the absence.
  cached: { why: 'computed-field caching was pruned in 2026-06 (#3733); nothing read it.' },
});

/**
 * Semantic near-misses on `ObjectSchema`. Smaller than the field table because
 * the object surface has drifted less — `capabilities` is the one #4120 caught,
 * and it had silenced an entire seven-toggle section of the metadata form.
 */
export const OBJECT_KEY_GUIDANCE: Readonly<
  Record<string, { to?: string; why?: string }>
> = Object.freeze({
  capabilities: { to: 'enable' },
  features: { to: 'enable' },
  namespace: { why: 'deprecated and removed — the object `name` is the canonical id everywhere. For module grouping embed a prefix in the name (`sys_user`).' },
  tableName: { why: 'removed — the table name always equals the object `name`.' },
});

/**
 * Semantic near-misses on the stack's own TOP-LEVEL keys
 * (`ObjectStackDefinitionSchema`).
 *
 * Same silent-drop mechanism as the two tables above, one level up. The walker
 * covers every metadata COLLECTION; this covers the envelope those collections
 * sit in, which is where the silence is easiest to miss — an undeclared
 * top-level key reads as configuration that took effect.
 *
 * `storage` is the worked example (#4167): `os serve` honoured it only on the
 * one boot path that skips `defineStack`, so the same key configured a backend
 * in one place and vanished in every other. A stack asking for S3 could
 * silently get local disk.
 */
export const STACK_KEY_GUIDANCE: Readonly<
  Record<string, { to?: string; why?: string }>
> = Object.freeze({
  storage: {
    why: 'the file-storage backend is a deployment concern, not an application declaration. '
      + 'Configure it with the OS_STORAGE_* environment variables, or per-deployment in Setup → Settings → Storage '
      + '(which also holds credentials — a stack definition would commit them to git and to any published artifact).',
  },
});

/**
 * Authored TOP-LEVEL members the **runtime executes off the bundle**, which the
 * stack schema therefore does not — and cannot — declare.
 *
 * `onEnable` is a function. It cannot survive `ObjectStackDefinitionSchema`
 * (which does not declare it) and it cannot survive `dist/objectstack.json`
 * (JSON has no functions), yet it is not lost: `AppPlugin` reads it straight
 * off the authored bundle and calls it at `start()`, and on the artifact-boot
 * path the CLI grafts it back (#4095). It is the documented place to register
 * action handlers, and `examples/app-todo` and `examples/app-showcase` both
 * ship it.
 *
 * So the lint must stay SILENT here. "Not declared" and "dropped at load" are
 * different claims, and this is the one surface where they come apart — telling
 * an author their working `onEnable` is being discarded would be a confident
 * lie about the pattern we ship in our own examples.
 *
 * `functions` is listed for the same reason (a name → handler map the runtime
 * resolves string-named hooks against); the schema happens to declare it too,
 * so it self-excludes. `onDisable` is deliberately ABSENT: no kernel, runtime
 * or service ever called it (the protocol declared it until #4212 retired the
 * whole uninvoked lifecycle family), so a value written there really does go
 * nowhere and the lint should say so.
 *
 * Single source of truth — the CLI's `GRAFTABLE_RUNTIME_MEMBERS` is derived
 * from this, so the list that decides what gets grafted and the list that
 * decides what the lint stays quiet about cannot drift apart.
 */
export const STACK_RUNTIME_MEMBERS = Object.freeze(['onEnable', 'functions'] as const);

/** A plain object — the only shape an authored metadata item can take. */
export function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Compare one authored record's keys against a declared key set, appending a
 * finding per unknown key. The single comparator behind every surface the
 * walker covers.
 *
 * Keys starting with `_` are skipped: they are the packaging/provenance channel
 * (`_packageId`, `_lock`, `_provenance`) that tooling stamps onto artifacts, and
 * a stray one is a tooling concern, not an authoring mistake.
 */
export function lintAuthoredRecordKeys(
  record: Record<string, unknown>,
  declared: ReadonlySet<string>,
  guidance: Readonly<Record<string, { to?: string; why?: string }>>,
  surface: AuthoringKeySurface,
  basePath: string,
  out: UnknownAuthoringKeyFinding[],
): void {
  const candidates = [...declared];
  for (const key of Object.keys(record)) {
    if (declared.has(key) || key.startsWith('_')) continue;

    const hint = guidance[key];
    // A retirement (`why`, no `to`) deliberately suppresses the edit-distance
    // fallback: there IS no successor, and the nearest declared key by spelling
    // is noise — `pii` is 3 edits from `min`, which would read as real advice.
    const suggestion = hint?.to ?? (hint?.why ? undefined : findClosestMatches(key, candidates, 3, 1)[0]);
    out.push({
      path: `${basePath}.${key}`,
      surface,
      key,
      ...(suggestion ? { suggestion } : {}),
      ...(hint?.why ? { guidance: hint.why } : {}),
    });
  }
}

/** One human-readable line for a finding — shared by `defineStack` and the CLI. */
export function formatUnknownAuthoringKey(f: UnknownAuthoringKeyFinding): string {
  const head = `${f.path}: '${f.key}' is not a declared ${f.surface} key, so its value is dropped at load`;
  if (f.guidance) return `${head} — ${f.guidance}`;
  if (f.suggestion) return `${head} — did you mean '${f.suggestion}'?`;
  return `${head}.`;
}
