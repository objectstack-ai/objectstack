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
 * @see ADR-0049 enforce-or-remove · ADR-0104 · #4001 (the strict tiers)
 */

import { findClosestMatches } from '../shared/suggestions.zod';
import { ObjectSchema } from './object.zod';
import { FieldSchema } from './field.zod';

/** Which authoring surface a finding came from. */
export type AuthoringKeySurface = 'object' | 'field';

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
  maskingRule: { why: 'pruned in 2026-06 as dead in both layers — masking was never applied.' },
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

/** Declared top-level keys of a Zod object schema, read off `.shape`. */
function declaredKeys(schema: unknown): readonly string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  return shape ? Object.keys(shape) : [];
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Compare one authored record's keys against a declared key set.
 *
 * Keys starting with `_` are skipped: they are the packaging/provenance channel
 * (`_packageId`, `_lock`, `_provenance`) that tooling stamps onto artifacts, and
 * a stray one is a tooling concern, not an authoring mistake.
 */
function lintRecord(
  record: Record<string, unknown>,
  declared: readonly string[],
  guidance: Readonly<Record<string, { to?: string; why?: string }>>,
  surface: AuthoringKeySurface,
  basePath: string,
  out: UnknownAuthoringKeyFinding[],
): void {
  const known = new Set(declared);
  for (const key of Object.keys(record)) {
    if (known.has(key) || key.startsWith('_')) continue;

    const hint = guidance[key];
    // A retirement (`why`, no `to`) deliberately suppresses the edit-distance
    // fallback: there IS no successor, and the nearest declared key by spelling
    // is noise — `pii` is 3 edits from `min`, which would read as real advice.
    const suggestion = hint?.to ?? (hint?.why ? undefined : findClosestMatches(key, declared, 3, 1)[0]);
    out.push({
      path: `${basePath}.${key}`,
      surface,
      key,
      ...(suggestion ? { suggestion } : {}),
      ...(hint?.why ? { guidance: hint.why } : {}),
    });
  }
}

/**
 * Report every key an authored stack sets on an object or field that the schema
 * does not declare — i.e. every value the parse is about to discard silently.
 *
 * Pure and side-effect free. Runs on the **raw** (normalized but unparsed)
 * stack: see the module note for why a parsed stack is too late.
 *
 * @param rawStack The authored stack, after `normalizeStackInput` and before
 *   `ObjectStackDefinitionSchema.parse`.
 */
export function lintUnknownAuthoringKeys(rawStack: unknown): UnknownAuthoringKeyFinding[] {
  if (!isPlainRecord(rawStack)) return [];
  const objects = rawStack.objects;
  if (!Array.isArray(objects)) return [];

  const objectKeys = declaredKeys(ObjectSchema);
  const fieldKeys = declaredKeys(FieldSchema);
  // A schema that failed to expose a shape would make this rule silently pass on
  // everything — the failure mode a lint must not have.
  if (objectKeys.length === 0 || fieldKeys.length === 0) return [];

  const out: UnknownAuthoringKeyFinding[] = [];
  for (const obj of objects) {
    if (!isPlainRecord(obj)) continue;
    const objName = typeof obj.name === 'string' && obj.name ? obj.name : '<unnamed>';
    const objPath = `objects.${objName}`;
    lintRecord(obj, objectKeys, OBJECT_KEY_GUIDANCE, 'object', objPath, out);

    const fields = obj.fields;
    if (!isPlainRecord(fields)) continue;
    for (const [fieldName, field] of Object.entries(fields)) {
      if (!isPlainRecord(field)) continue;
      lintRecord(
        field,
        fieldKeys,
        FIELD_KEY_GUIDANCE,
        'field',
        `${objPath}.fields.${fieldName}`,
        out,
      );
    }
  }
  return out;
}

/** One human-readable line for a finding — shared by `defineStack` and the CLI. */
export function formatUnknownAuthoringKey(f: UnknownAuthoringKeyFinding): string {
  const head = `${f.path}: '${f.key}' is not a declared ${f.surface} key, so its value is dropped at load`;
  if (f.guidance) return `${head} — ${f.guidance}`;
  if (f.suggestion) return `${head} — did you mean '${f.suggestion}'?`;
  return `${head}.`;
}
