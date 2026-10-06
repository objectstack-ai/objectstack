// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$search` → cross-field filter expansion (ADR-0061, Tier 1).
 *
 * The picker / list / command-palette surfaces all send a `$search` string;
 * historically the data layer dropped it (a silent no-op). This module turns
 * that string into a driver-agnostic `$or` of `$icontains` predicates across the
 * object's *server-resolved* searchable fields — every driver already executes
 * `$or` + `$icontains`, so no driver changes are needed.
 *
 * Field resolution (server-side, never client-trusted) lives in
 * `@objectstack/spec/data` (`search-fields.ts`) since #4254, because the REST
 * ingress gate must consult the SAME rule when it refuses a `$searchFields`
 * override the engine would not scan — see that module for the precedence
 * (declared `searchableFields` → auto-default) and the override intersection.
 *
 * Matching: case-insensitive; multiple whitespace-separated terms are AND-ed
 * (every term must hit some field); fields are OR-ed. `select`/`status` columns
 * store a value but users type the label, so the term is mapped to option
 * values whose label matches (with a raw-value `$icontains` fallback).
 *
 * [#7641] The case-insensitive operator is `$icontains`, NOT `$contains`.
 * `$contains` is contractually case-SENSITIVE (#4706 Q2 = A), so the
 * `$contains` this module emitted until #7641 made the sentence above a
 * declaration the executor did not honour on textual fields: SQLite's `LIKE`
 * used to fold ASCII incidentally and hid it, and #6518's `LIKE`→`GLOB` change
 * removed that accident. Nothing about either OPERATOR changed here — only
 * which one `$search` compiles to. Every filter face already answers
 * `$icontains` (#6520 / #6682): both `driver-sql` compilers (and
 * `driver-sqlite-wasm` / turso-local by inheritance), turso's independent
 * `RemoteTransport`, service-analytics' read-scope and cube lowerings,
 * `formula`'s RLS matcher, objectql's own HAVING evaluator, and
 * `driver-memory` / `driver-mongodb` — which got it as a sanctioned one-off
 * while they were under the #5499 investment freeze, lifted 2026-08-11.
 *
 * Pinyin recall (#2486): when the object carries the hidden `__search`
 * companion column (provisioned by the SchemaRegistry when
 * `OS_SEARCH_PINYIN_ENABLED` is on, populated by plugin-pinyin-search), each
 * latin term additionally ORs `{ __search: { $contains: term } }` so full
 * pinyin (`zhangwei`) and initials (`zw`) hit CJK names. Purely additive:
 * `resolveSearchFields` still returns only source fields (the companion is
 * invisible to `$searchFields` overrides and to clients).
 *
 * [#21880] …and bounded by the same set. The companion is a normalized copy of
 * named source fields, so its clause is a match on THOSE fields. It joins a
 * search only when every field it mirrors is inside the effective search-field
 * set `resolveSearchFields` computed — after any `$searchFields` narrowing — and
 * a set that leaves a mirrored field out leaves the companion out with it. See
 * {@link companionWithinSearchFields}.
 *
 * [#21009] A field the object declares MULTI-VALUED (`isMultiValueField`: a
 * `tags` / `multiselect` / `checkboxes` field, or a `select` / `lookup` /
 * `user` / … declared `multiple: true`) is matched by MEMBERSHIP, `$contains`,
 * never by `$icontains` or `$in`. Such a field is stored as a JSON array, and
 * every operator but the membership pair is refused on it with `INVALID_FILTER`
 * / 400 (`@objectstack/core`'s `JSON_COLUMN_INCOMPATIBLE_OPERATORS`) — so one
 * multi-valued field in the resolved set used to fail the WHOLE search: a label
 * term's `$in` was refused on every dialect, and the raw `$icontains` was
 * refused too once the text family joined that set (before it, PostgreSQL
 * answered it with a 500 and SQLite matched substrings of the serialized
 * array). The label → value mapping still applies: each matched option value
 * becomes one `$contains` clause in the term's `$or`, and a term matching no
 * label — or a field with no options, such as `tags` or a multi-valued lookup
 * — becomes `$contains: term`. The visible cost: a term must EQUAL a member,
 * or match an option label, to hit a multi-valued field. The declaration is
 * read from the field map the engine already passes in (`fields`), whose
 * entries are the object's full field definitions — `multiple` included.
 */

import {
  isMultiValueField,
  resolveSearchFields,
  SEARCHABLE_ENUM_TYPES,
  type SearchFieldMeta,
  type SearchFieldResolutionOptions,
} from '@objectstack/spec/data';
import {
  SEARCH_COMPANION_FIELD,
  isCompanionMatchableTerm,
  resolveSearchCompanionSources,
  type CompanionObjectMeta,
} from './search-companion.js';

export {
  resolveSearchFields,
  resolveSearchFieldResolution,
  SEARCHABLE_TEXTUAL_TYPES,
  SEARCHABLE_ENUM_TYPES,
  SEARCH_AUTO_EXCLUDED_FIELDS,
  SEARCH_AUTO_EXCLUDED_TYPES,
} from '@objectstack/spec/data';
export type { SearchFieldMeta } from '@objectstack/spec/data';

/** Historical name for {@link SearchFieldResolutionOptions} — same shape. */
export type ExpandSearchOptions = SearchFieldResolutionOptions;

export interface NormalizedSearch {
  query: string;
  fields?: string[];
}

/** Accept the term in any shape it may reach the engine under. */
export function normalizeSearch(raw: unknown): NormalizedSearch {
  if (raw == null) return { query: '' };
  if (typeof raw === 'string') return { query: raw };
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const q = typeof o.query === 'string' ? o.query : typeof o.q === 'string' ? o.q : '';
    const fields = Array.isArray(o.fields) ? (o.fields as string[]) : undefined;
    return { query: q, fields };
  }
  return { query: '' };
}

function optionValuesMatching(meta: SearchFieldMeta, term: string): unknown[] {
  if (!Array.isArray(meta.options)) return [];
  const lc = term.toLowerCase();
  const out: unknown[] = [];
  for (const opt of meta.options) {
    if (opt == null) continue;
    if (typeof opt === 'string') {
      if (opt.toLowerCase().includes(lc)) out.push(opt);
      continue;
    }
    const label = String((opt as any).label ?? (opt as any).value ?? '');
    if (label.toLowerCase().includes(lc)) out.push((opt as any).value);
  }
  return out;
}

/**
 * [#21009] Does the object declare this search field multi-valued? Asked of the
 * field definition the engine handed in: `SearchFieldMeta` names only what the
 * field RESOLUTION reads, but each entry of `fields` is the object's whole
 * field definition, so its `multiple` flag is there to read.
 */
function isMultiValuedSearchField(meta: SearchFieldMeta): boolean {
  const { type, multiple } = meta as SearchFieldMeta & { multiple?: unknown };
  return typeof type === 'string' && isMultiValueField({ type, multiple: multiple === true });
}

function fieldClausesForTerm(field: string, term: string, meta: SearchFieldMeta): any[] {
  // [#21009] Membership on a multi-valued field — see the module header.
  if (isMultiValuedSearchField(meta)) {
    const values = optionValuesMatching(meta, term).filter((v) => v !== null && v !== undefined);
    if (values.length > 0) return values.map((v) => ({ [field]: { $contains: String(v) } }));
    return [{ [field]: { $contains: term } }];
  }
  if (SEARCHABLE_ENUM_TYPES.has(meta?.type ?? '')) {
    const values = optionValuesMatching(meta, term);
    // The label→value path is already case-insensitive in JS (see
    // `optionValuesMatching`) and emits an exact-value `$in` — untouched by
    // #7641. Only the raw-value FALLBACK below is an operator clause, and it
    // folds for the same reason the textual clause does.
    if (values.length > 0) return [{ [field]: { $in: values } }];
    return [{ [field]: { $icontains: term } }];
  }
  return [{ [field]: { $icontains: term } }];
}

/**
 * [#21880] May the `__search` companion clause join a search over
 * `searchFields`? Only when every source field the companion mirrors is in
 * that set.
 *
 * The mirrored fields are read from {@link resolveSearchCompanionSources} —
 * the one function the registry's provisioning seam and plugin-pinyin-search's
 * populate hook already derive the companion from — over the same `fields` and
 * the same display-field pointer the engine handed in. So the answer is the
 * companion's real source, never a second guess at it.
 *
 * ⛔ The gate is `searchFields` and nothing else: the set `resolveSearchFields`
 * already computed, with the declared/auto-default precedence and any
 * `$searchFields` narrowing applied. No second eligibility rule for the
 * companion is consulted here — whatever a caller's narrowing removed from the
 * source columns, it removes from their normalized copy too.
 *
 * The companion is ONE column holding the normalized form of its sources, so
 * the test is "every source is in the set", never "some source is": a clause
 * over the shared column matches through every field it mirrors at once.
 * A search whose set holds every mirrored field — any search with no
 * narrowing, whenever the display/name field is in the object's searchable
 * set — keeps the clause, so recall there is unchanged.
 *
 * An empty source list passes vacuously. The registry never provisions a
 * companion without a source (`provisionSearchCompanion` returns early on an
 * empty list), so that case is only an author-declared `__search` column —
 * an ordinary field the platform does not fill — and it keeps today's answer.
 */
function companionWithinSearchFields(searchFields: readonly string[], opts: ExpandSearchOptions): boolean {
  const sources = resolveSearchCompanionSources({
    nameField: opts.displayField,
    fields: opts.fields as CompanionObjectMeta['fields'],
  });
  const inSet = new Set(searchFields);
  return sources.every((f) => inSet.has(f));
}

/**
 * Expand a `$search` term into a `{ $or: [...] }` (single term) or
 * `{ $and: [{ $or: [...] }, ...] }` (multi-term) filter. Returns `null` when
 * there's nothing to search (empty query or no resolvable fields) so the caller
 * leaves the existing filter untouched.
 */
export function expandSearchToFilter(raw: unknown, opts: ExpandSearchOptions): any | null {
  const { query, fields: requested } = normalizeSearch(raw);
  if (!query || !query.trim()) return null;

  const searchFields = resolveSearchFields({
    ...opts,
    requestedFields: requested ?? opts.requestedFields,
  });
  if (searchFields.length === 0) return null;

  const terms = query.trim().split(/\s+/).filter(Boolean);
  // [#2486] Companion recall: present only when the registry provisioned the
  // hidden `__search` column for this object (deployment-gated). The companion
  // stores lowercase normalized forms, so the term is lowercased; CJK terms
  // skip the clause (they hit the source columns directly and can never match
  // the ASCII companion).
  //
  // [#7641] This clause deliberately stays `$contains`: the companion is a
  // NORMALIZED blob that is already lowercase on BOTH sides (the column by
  // construction, the term by `.toLowerCase()` below), so a case-SENSITIVE
  // operator over two folded values is exact, not a case bug. This is a
  // different mechanism from the source-column clauses in
  // `fieldClausesForTerm`, which compare against raw stored text and therefore
  // need `$icontains`. Do not "align" the two.
  //
  // [#21880] …and only when the companion mirrors no field outside
  // `searchFields` — see `companionWithinSearchFields`.
  const withCompanion = !!opts.fields[SEARCH_COMPANION_FIELD]
    && companionWithinSearchFields(searchFields, opts);
  const andClauses = terms.map((term) => {
    const clauses = searchFields.flatMap((f) => fieldClausesForTerm(f, term, opts.fields[f] || {}));
    if (withCompanion && isCompanionMatchableTerm(term)) {
      clauses.push({ [SEARCH_COMPANION_FIELD]: { $contains: term.toLowerCase() } });
    }
    return { $or: clauses };
  });

  if (andClauses.length === 0) return null;
  return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
}
