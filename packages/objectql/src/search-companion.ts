// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Search-normalization companion column (`__search`) — pinyin recall (#2486).
 *
 * `$search` (ADR-0061 Tier 1) is a `$contains` over source columns, so typing
 * the full pinyin (`zhangwei`) or initials (`zw`) of a CJK name ("张伟") can
 * never hit — the stored value is the CJK original. This module provides the
 * additive fix: a single hidden companion column per object that stores
 * search-normalized forms of the object's display/name field
 * ("zhangwei zw"), OR-ed into the search filter at query time.
 *
 * Design constraints (issue #2486):
 *   - NO field-level metadata: the capability is deployment/locale-gated via
 *     `OS_SEARCH_PINYIN_ENABLED` (see `resolveSearchPinyinEnabled` in
 *     `@objectstack/types`), so there is no declared-but-unenforced marker
 *     (ADR-0049) and no per-field opt-in to audit.
 *   - Materialization set ≠ search set: ONLY the resolved display/name field
 *     (ADR-0079 `resolveDisplayField`) feeds the companion — one column per
 *     object. Other fields are searched via their source columns directly.
 *   - Declared at object compile time (the SchemaRegistry materialization
 *     seam, next to `provisionPrimary`), so the driver's `syncSchema`
 *     migrates the column additively (ADR-0045) and every consumer sees the
 *     same shape. `plugin-pinyin-search` only FILLS the value (the
 *     `plugin-sharing` primary-BU projection pattern).
 *   - Security (ADR-0061 D5): a source field with field-level read
 *     restrictions (`requiredPermissions`) or a secret-ish type never feeds
 *     the companion — otherwise "search hit ⇒ value inference" becomes an
 *     FLS-bypass oracle. Enforced here at the single eligibility gate, not
 *     left to author discipline.
 *
 * The companion is an instance of the generic "search normalizer" seam —
 * `SEARCH_COMPANION_NORMALIZERS` names the applied normalizers. Only
 * `pinyin` is implemented; future normalizers (simplified/traditional
 * conversion, width folding, accent folding) extend the same list and reuse
 * the same column.
 */

import { resolveDisplayField, TITLE_ELIGIBLE_TYPES } from '@objectstack/spec/data';

/**
 * Name of the hidden companion column. Double-underscore prefixed so it can
 * never collide with an author-declared field (machine names are snake_case
 * words) and reads as platform plumbing in raw rows.
 */
export const SEARCH_COMPANION_FIELD = '__search';

/**
 * Normalizers applied to the companion column. Generalization seam: pinyin is
 * the only implemented normalizer; the list form keeps the door open for
 * future ones without a schema change.
 */
export const SEARCH_COMPANION_NORMALIZERS = ['pinyin'] as const;

/** Minimal field shape this module inspects (same spirit as SearchFieldMeta). */
export interface CompanionFieldMeta {
  type?: string;
  hidden?: boolean;
  system?: boolean;
  requiredPermissions?: readonly string[];
  [k: string]: unknown;
}

/** Minimal object shape this module inspects. */
export interface CompanionObjectMeta {
  name?: string;
  nameField?: string;
  displayNameField?: string;
  searchable?: boolean;
  fields?: Record<string, CompanionFieldMeta>;
  [k: string]: unknown;
}

/**
 * Types whose values may feed the companion. Stored text-ish columns only —
 * `formula` is excluded even when title-eligible because its value is virtual
 * (computed on read), so there is no persisted source to normalize from.
 */
function isCompanionSourceType(type: string | undefined): boolean {
  if (!type) return false;
  if (type === 'formula') return false;
  return TITLE_ELIGIBLE_TYPES.has(type);
}

/**
 * May `fieldMeta` feed the companion column?
 *
 * Fail-closed security gate (ADR-0061 D5 extended): only fields readable by
 * EVERY accessor of the object may be denormalized into the shared companion.
 * Fields with field-level read restrictions (`requiredPermissions`), hidden
 * fields, and non-text/secret-ish types are excluded — a companion hit on a
 * restricted value would leak it through the result set even though the field
 * itself is masked.
 */
export function isCompanionSourceEligible(fieldMeta: CompanionFieldMeta | undefined | null): boolean {
  if (!fieldMeta) return false;
  if (fieldMeta.hidden === true) return false;
  if (Array.isArray(fieldMeta.requiredPermissions) && fieldMeta.requiredPermissions.length > 0) return false;
  return isCompanionSourceType(fieldMeta.type);
}

/**
 * Resolve the source fields that feed an object's companion column: the
 * ADR-0079 display/name field, when it exists and passes the eligibility
 * gate. Returns `[]` when the object has no eligible name source (the
 * companion is then neither provisioned nor populated).
 *
 * Single source of truth shared by the compile-time provisioning seam
 * ({@link provisionSearchCompanion}) and the `plugin-pinyin-search` populate
 * hook — deriving both from the same function means there is no stored
 * mapping to drift.
 */
export function resolveSearchCompanionSources(schema: CompanionObjectMeta | undefined | null): string[] {
  if (!schema?.fields) return [];
  const display = resolveDisplayField(schema as any);
  if (!display) return [];
  const meta = schema.fields[display];
  return isCompanionSourceEligible(meta) ? [display] : [];
}

/**
 * Compile-time provisioning: return `schema` with the hidden `__search`
 * companion column appended when the object has an eligible name source.
 * Pure and idempotent — an already-provisioned or ineligible schema is
 * returned as-is (same reference).
 *
 * The column is `hidden` + `system` + `readonly` (+ `searchable: false`), so
 * it never appears in auto-generated views/forms, is excluded from the
 * `$search` auto-default (hidden fields are skipped) and from `$searchFields`
 * overrides (the override intersects with the allowed set), and non-system
 * callers cannot forge it on update (#2948 readonly write guard).
 *
 * [#7561] It carries NO index — and the stamp that claimed otherwise is gone.
 * This block used to append `index: true` and the paragraph above used to read
 * "It IS `index`ed — every search touches it". Both were false, in the #6810
 * shape one field over (`applySystemFields` stamping `indexed` on
 * `organization_id`): `index` was removed from `FieldSchema` in the 16.x line
 * (#2377, ADR-0049) because a field-level index flag built no index, and
 * `FieldSchema` is a `strictObject`, so the key was rejected BY NAME. The
 * companion is provisioned BEFORE the document is stored and `/meta` re-parses
 * the served body, so the stamp put `_diagnostics: { valid: false, errors:
 * [{ path: 'fields.__search', code: 'unrecognized_keys' }] }` on every object
 * the platform provisions a companion for — a defect the platform reported
 * about its own column, on a document no author wrote or could fix.
 *
 * Unlike #6810 the index is NOT re-declared in the object's `indexes[]`, and
 * that is a measured difference rather than an omission. #6810's predicate is
 * `organization_id = ?` — equality, which a B-tree serves. This column's ONLY
 * reader is `buildSearchFilter`, which emits `{ __search: { $contains: term } }`
 * (`search-filter.ts`) — a leading-wildcard `LIKE '%term%'` that no B-tree can
 * answer, and `IndexSchema` spells nothing else (`name` / `fields` / `unique`;
 * no trigram/GIN method). Declaring one would buy write amplification on every
 * row for a read path that cannot use it. If the companion ever warrants a
 * real substring index, it needs an `IndexSchema` that can express one — a
 * separate change, not a dead index declared here.
 *
 * Objects that opt out of search entirely (`searchable: false`, ADR-0061 D2)
 * are skipped: a companion no query will ever read is dead weight.
 */
export function provisionSearchCompanion<T extends CompanionObjectMeta>(schema: T): T {
  if (!schema?.fields) return schema;
  if (schema.fields[SEARCH_COMPANION_FIELD]) return schema;
  if (schema.searchable === false) return schema;
  if (resolveSearchCompanionSources(schema).length === 0) return schema;

  return {
    ...schema,
    fields: {
      ...schema.fields,
      [SEARCH_COMPANION_FIELD]: {
        type: 'text',
        label: 'Search Index',
        required: false,
        hidden: true,
        readonly: true,
        system: true,
        searchable: false,
        description:
          `Search-normalized forms of the display/name field (normalizers: ${SEARCH_COMPANION_NORMALIZERS.join(', ')}) — ` +
          'e.g. full pinyin + initials for CJK names. Maintained by plugin-pinyin-search; never hand-edited. See #2486.',
      },
    },
  };
}

const CJK_RE = /\p{Script=Han}/u;

/** Does the string contain CJK (ideograph) characters? */
export function containsCJK(value: unknown): boolean {
  return typeof value === 'string' && CJK_RE.test(value);
}

/**
 * Is `term` worth matching against the companion column? Pinyin input is
 * latin: a term carrying CJK characters can never match the ASCII-normalized
 * companion, and a term with no letters at all (pure punctuation/digits)
 * isn't pinyin. Keeps the extra OR clause off queries it cannot help.
 */
export function isCompanionMatchableTerm(term: string): boolean {
  return /[a-z]/i.test(term) && !CJK_RE.test(term);
}

/**
 * Did the caller NAME the companion column in its projection? (#7642)
 *
 * The strip below is a DEFAULT-projection rule, so it has to be able to tell
 * "the caller asked for everything" from "the caller asked for this column".
 * Read the caller's ORIGINAL `fields`, never the planned one: when a formula
 * field is in play `planFormulaProjection` rewrites `ast.fields` to every
 * stored column on the schema — companion included — so a post-planning read
 * would report "explicitly requested" for a query that named only `name`.
 */
export function isSearchCompanionRequested(fields: unknown): boolean {
  return Array.isArray(fields) && fields.includes(SEARCH_COMPANION_FIELD);
}

/**
 * Remove the companion column from records on their way OUT of the engine
 * (#7642).
 *
 * The column is declared `hidden` + `readonly` + `system` + `searchable:
 * false`, and those flags are all real — they keep it out of auto-views, out
 * of the `$search` auto-default and out of `$searchFields` overrides (which
 * refuse it with a 400 "is hidden"). None of them is a PROJECTION rule,
 * though: no read path narrowed the default projection, the drivers answer an
 * absent `fields` with `SELECT *`, and so every record body — query results,
 * GET by id, `/search` hits, the 201 create body — carried `__search`.
 *
 * ## Why this is not gated on the schema declaring the column
 *
 * It cannot be. The symptom outlives the switch: `OS_SEARCH_PINYIN_ENABLED=false`
 * stops {@link provisionSearchCompanion} from DECLARING the field, but the
 * physical column stays in the table (ADR-0045 migrations are additive), the
 * stored values stay in it, and `SELECT *` keeps returning them. A strip that
 * asked `schema.fields.__search` first would therefore go silent in exactly
 * the deployment that reported the bug. The key on the ROW is the only
 * reliable signal, and deleting an absent key costs nothing.
 *
 * ## Scope — `__search` only
 *
 * Deliberately this one column, not "hidden system columns" as a class.
 * Hidden system columns DO come back generally (`organization_id` is the
 * obvious one), but they are load-bearing in client payloads today; removing
 * them is a contract decision, not a defect fix. See #7642.
 *
 * Mutates in place, like {@link ObjectQL.maskSecretFields} — the driver
 * contract already forbids handing back live references into the backing
 * store (`MemoryDriver.find` spells this out), so the row being mutated is
 * the caller's copy.
 */
export function stripSearchCompanion(records: unknown): void {
  if (records == null) return;
  const rows: unknown[] = Array.isArray(records) ? records : [records];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    delete (row as Record<string, unknown>)[SEARCH_COMPANION_FIELD];
  }
}
