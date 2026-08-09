// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$search` field resolution (ADR-0061, Tier 1) — which columns a search scans.
 *
 * ONE resolution shared by the two layers that must agree on it:
 *
 * - the ENGINE (`@objectstack/objectql` `expandSearchToFilter`), which expands
 *   a `$search` term into a `$or` of `$contains` clauses over exactly this set;
 * - the INGRESS gate (`@objectstack/metadata-protocol` `findData`), which
 *   refuses a `$searchFields` override naming a field this set does not admit
 *   (#4254), instead of letting the engine drop it silently.
 *
 * The two used to be one (the rule lived inside the engine), and #4254 keeps
 * them one by moving the rule HERE rather than copying it: a gate that
 * re-implemented "which fields are searchable" would drift from what the
 * engine actually scans, and then either reject a search that would have
 * worked or admit one the engine ignores — the same drift #4226 avoided on the
 * expand axis by having gate and engine read `REFERENCE_VALUE_TYPES`.
 *
 * Resolution precedence (server-side, never client-trusted):
 *   1. the object's declared `searchableFields` (filtered to entries that exist
 *      AND have a stored column to scan — #6674)
 *   2. an auto-default: the display/name field + short-text and enum fields.
 *
 * An explicit `$searchFields` override is then INTERSECTED with that allowed
 * set — it can narrow the scan, never widen it (`resolveSearchFields`).
 */

/** The slice of field metadata search resolution reads. */
export interface SearchFieldMeta {
  type?: string;
  hidden?: boolean;
  options?: Array<{ label?: string; value: unknown } | string> | unknown;
}

/** Short-text field types that make sense as `$contains` search targets. */
export const SEARCHABLE_TEXTUAL_TYPES: ReadonlySet<string> = new Set([
  'text', 'email', 'phone', 'url', 'autonumber', 'textarea', 'markdown',
]);
/** Enumerated types searched by mapping the query to option values via labels. */
export const SEARCHABLE_ENUM_TYPES: ReadonlySet<string> = new Set(['select', 'status']);
/** System / audit / heavy fields never auto-included. */
export const SEARCH_AUTO_EXCLUDED_FIELDS: ReadonlySet<string> = new Set([
  'id', '_id', 'created', 'modified', 'created_at', 'updated_at',
  'created_by', 'updated_by', 'owner_id', 'organization_id', 'space', 'company_id',
]);
export const SEARCH_AUTO_EXCLUDED_TYPES: ReadonlySet<string> = new Set([
  'json', 'object', 'grid', 'image', 'file', 'avatar', 'vector', 'location',
  'geometry', 'secret', 'password', 'encrypted', 'boolean', 'lookup', 'master_detail',
]);
/**
 * [#6674] Field types with NO STORED COLUMN — the value is computed on read, so
 * a `$contains` scan has nothing to look at. Exactly `formula` today.
 *
 * This is a STORAGE fact, not a taste judgment, and that is what separates it
 * from the three vocabularies above. `SEARCH_AUTO_EXCLUDED_TYPES` says "the
 * auto-default does not GUESS this type" — an author may still declare a `json`
 * or `lookup` column in `searchableFields` and the engine executes it (a
 * `$contains` over the stored JSON text, over the stored foreign key), which is
 * a choice that can match. A `formula` entry cannot: the drivers materialize no
 * column for it (`driver-sql/src/schema-drift.ts` `fieldHasColumn`,
 * `driver-turso/src/remote-transport.ts` "Virtual — no column"), and the engine
 * excludes it from the projection it sends down (`objectql/src/engine.ts`
 * `buildFormulaPlan`) because the driver would fail on the column name.
 * Measured on both backends: `{formula_field: {$contains: 'Apollo'}}` returns
 * 0 rows on driver-memory (the property is absent from the stored row) and 0
 * rows with NO error on driver-sql/better-sqlite3.
 *
 * So the declared branch of {@link resolveSearchFieldResolution} filters these
 * out, and the two enforcement faces refuse them by NAME — see that function.
 *
 * The set is pinned to exactly `['formula']` in `search-fields.test.ts`: it
 * mirrors the drivers' own storage rule, and a driver growing a second virtual
 * type must widen this deliberately rather than by drift.
 */
export const SEARCH_VIRTUAL_TYPES: ReadonlySet<string> = new Set(['formula']);

/**
 * Is this field virtual — computed on read, with no stored column for `search`
 * to scan? The ONE judgment behind the refusal, exported so the REST ingress
 * gate (`assertSearchFieldsAreSearchable`) and the linter
 * (`validate-searchable-fields`) word their refusals from the same fact the
 * resolution below applies, instead of each carrying its own type literal —
 * the one-source move #4254 made between gate and engine.
 *
 * A field whose `type` is unreadable is NOT virtual: unresolvable is not wrong
 * (ADR-0072 D1), and the lint mirror feeds stub metadata (`{}`) for
 * registry-injected system columns it cannot see.
 */
export function isVirtualSearchField(meta: SearchFieldMeta | undefined | null): boolean {
  return !!meta && typeof meta.type === 'string' && SEARCH_VIRTUAL_TYPES.has(meta.type);
}

export interface SearchFieldResolutionOptions {
  /** The object's field map (name → metadata). */
  fields: Record<string, SearchFieldMeta>;
  /** Object-declared `searchableFields` (the canonical default set). */
  searchableFields?: string[];
  /** Validated `$searchFields` override — intersected with the allowed set.
   *  Accepts an array or a comma-separated string (the form a URL query param
   *  arrives as). */
  requestedFields?: string | string[];
  /** Preferred display field, placed first in the auto-default. */
  displayField?: string;
}

function autoDefaultFields(fields: Record<string, SearchFieldMeta>, displayField?: string): string[] {
  const names = Object.keys(fields).filter((f) => {
    if (SEARCH_AUTO_EXCLUDED_FIELDS.has(f)) return false;
    const meta = fields[f];
    if (!meta || meta.hidden) return false;
    const t = meta.type;
    if (!t) return false;
    // Redundant BY CONSTRUCTION, and kept deliberately (#6934).
    //
    // `SEARCH_AUTO_EXCLUDED_TYPES` is disjoint from both positive lists, so
    // every type it names already falls through the `return` below as `false`
    // — identically to a type in none of the three sets (`number`, `date`, …).
    // Measured over the full 56-type domain (`FieldType` ∪ all three
    // vocabularies), deleting this line moves not one resolution. So it is NOT
    // load-bearing: adding a type to `SEARCHABLE_TEXTUAL_TYPES` does not also
    // require keeping it out of this set for the auto-default to reject it.
    //
    // What it buys is the DIRECTION the two vocabularies resolve in should that
    // disjointness ever break. Both directions are silent — the guard is no
    // safety net, it is a second tiebreak — but they are not equally bad. WITH
    // it, an overlapping type is dropped from the scan (fail closed). WITHOUT
    // it the positive list wins and the type enters the auto-default AND, one
    // layer up, the #4254 ingress allow-list — so `$searchFields=<that field>`
    // flips from refused to ACCEPTED, the same widening #4483 closed for `id`.
    // This set names `secret`, `password`, `encrypted` and `vector`: failing
    // open there means a `$contains` scan over a masked or heavy column.
    //
    // The disjointness is not left to coincidence. `search-fields.test.ts` pins
    // all three vocabularies pairwise disjoint AND pins both resolution
    // directions, so an overlap is a red test rather than a silent tiebreak
    // whichever way it lands.
    if (SEARCH_AUTO_EXCLUDED_TYPES.has(t)) return false;
    return SEARCHABLE_TEXTUAL_TYPES.has(t) || SEARCHABLE_ENUM_TYPES.has(t);
  });
  // Lead with the display/name field — ORDERING ONLY (#4483).
  //
  // `lead` used to be picked by EXISTENCE (`fields[displayField]`), then
  // prepended unconditionally, so it re-entered the set after the three
  // exclusions above had already rejected it. That made
  // `SEARCH_AUTO_EXCLUDED_FIELDS` — whose contract is "never auto-included" —
  // untrue for whichever field happened to be the display field, and the case
  // is not contrived: ADR-0079's `provisionPrimary(schema, { synthesize: false })`
  // designates `nameField` at registration, and on a table whose only textual
  // column IS the primary key (system tables, junction tables, append-only
  // logs) it designates `id`. `$search` then expanded to
  // `{ id: { $contains: <term> } }` — a substring scan over the primary key.
  //
  // It also loosened the #4254 REST ingress gate one layer up, which asks this
  // same resolution whether a `$searchFields` override names a field the engine
  // would actually scan: with `id` in `allowed`, `$searchFields=id` was
  // ACCEPTED instead of refused.
  //
  // The lead's job is to put the primary title FIRST, never to admit it, so it
  // is now chosen from `names` — the already-filtered set. A display field that
  // is excluded, hidden or of an unsearchable type simply does not lead, and
  // the set is unchanged.
  const eligible = (f: string | undefined): f is string => !!f && names.includes(f);
  const lead = eligible(displayField) ? displayField
    : eligible('name') ? 'name'
    : eligible('title') ? 'title'
    : undefined;
  if (!lead) return names;
  return [lead, ...names.filter((f) => f !== lead)];
}

/**
 * The ALLOWED search-field set for an object, plus where it came from —
 * `declared` when the object's `searchableFields` (filtered to entries the
 * engine can actually scan) is non-empty, `auto` otherwise. The source matters
 * to the #4254 ingress gate because the two rejections it explains differ: a
 * field missing from a declared list is fixed by adding it there, while a field
 * the auto-default skips is excluded by its TYPE and needs `searchableFields`
 * declared to become a target.
 *
 * TWO filters run on the declared branch, and they are different claims:
 *
 * 1. EXISTENCE — an entry naming no field is dropped. A stale declaration
 *    (#4254); the ingress gate calls it out by that name.
 * 2. [#6674] SCANNABILITY — an entry naming a VIRTUAL field
 *    ({@link isVirtualSearchField}) is dropped. The entry names a real field,
 *    passes existence, and can still never match, because the field has no
 *    stored column for `$contains` to scan.
 *
 * Filter 2 is deliberately NOT a type allow-list on the declared branch. The
 * declaration remains the author's explicit choice and still bypasses the
 * auto-default's exclusions: a `json` or `lookup` column declared here is
 * executed by the engine as a `$contains` over the stored JSON text / stored
 * foreign key — narrow, rarely useful, but a scan that CAN match. Only "there
 * is no column at all" is refused, which is why the vocabulary is a storage
 * fact rather than a search-quality one.
 *
 * Why the drop is not the whole fix. Dropping alone would only make the
 * declaration silently NARROWER — the failure mode #4254 exists to close on
 * the neighbouring axis. So the two enforcement faces refuse a virtual entry
 * loudly, by name, from this same judgment:
 *
 * - the INGRESS gate (`assertSearchFieldsAreSearchable`,
 *   `@objectstack/metadata-protocol`) → `400 INVALID_FIELD`, because clients
 *   echo the declaration verbatim as `$searchFields`;
 * - the LINTER (`validate-searchable-fields`, `@objectstack/lint`) → a build
 *   error at authoring time, on the object's own set as well as a view's.
 *
 * This function itself stays non-throwing on purpose: it is consulted on every
 * search by internal callers (hooks, flows, registry-less hosts) that never
 * pass an ingress, and #4254 put the loudness at the ingress for exactly that
 * reason. What changes here is what a declaration is ADMITTED to say.
 *
 * Degenerate case, pinned in the tests: a declaration whose entries are ALL
 * virtual filters to empty and therefore falls through to the auto-default —
 * the same behaviour an all-stale declaration has had since #4254. Search
 * widens from "matched nothing, ever" to the auto-default set, and the linter
 * reports the declaration as an error rather than leaving the swap silent.
 */
export function resolveSearchFieldResolution(
  opts: Omit<SearchFieldResolutionOptions, 'requestedFields'>,
): { allowed: string[]; source: 'declared' | 'auto' } {
  const all = opts.fields || {};
  const declared = opts.searchableFields?.filter((f) => all[f] && !isVirtualSearchField(all[f]));
  if (declared && declared.length > 0) return { allowed: declared, source: 'declared' };
  return { allowed: autoDefaultFields(all, opts.displayField), source: 'auto' };
}

/**
 * Resolve the effective searchable field set (server-side, validated): the
 * allowed set, narrowed by a validated `requestedFields` override when one is
 * present.
 *
 * TOLERANT by design — unknown requested names are dropped, and a request
 * naming none of the allowed fields falls back to the full allowed set. This
 * guards INTERNAL callers (hooks, flows, registry-less hosts) that never pass
 * an ingress; the REST read path refuses those same inputs loudly BEFORE the
 * engine sees them (`400 INVALID_FIELD`, #4254), exactly like the projection
 * axis, whose engine-side `SELECT *` tolerance sits behind the #4226 gate.
 */
export function resolveSearchFields(opts: SearchFieldResolutionOptions): string[] {
  const { allowed } = resolveSearchFieldResolution(opts);
  const requested = typeof opts.requestedFields === 'string'
    ? opts.requestedFields.split(',').map((f) => f.trim()).filter(Boolean)
    : opts.requestedFields;
  if (requested && requested.length > 0) {
    const allowSet = new Set(allowed);
    const validated = requested.filter((f) => allowSet.has(f));
    if (validated.length > 0) return validated;
  }
  return allowed;
}
