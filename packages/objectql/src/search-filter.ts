// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `$search` → cross-field filter expansion (ADR-0061, Tier 1).
 *
 * The picker / list / command-palette surfaces all send a `$search` string;
 * historically the data layer dropped it (a silent no-op). This module turns
 * that string into a driver-agnostic `$or` of `$contains` predicates across the
 * object's *server-resolved* searchable fields — every driver already executes
 * `$or` + `$contains`, so no driver changes are needed.
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
 * values whose label matches (with a raw-value `$contains` fallback).
 *
 * Pinyin recall (#2486): when the object carries the hidden `__search`
 * companion column (provisioned by the SchemaRegistry when
 * `OS_SEARCH_PINYIN_ENABLED` is on, populated by plugin-pinyin-search), each
 * latin term additionally ORs `{ __search: { $contains: term } }` so full
 * pinyin (`zhangwei`) and initials (`zw`) hit CJK names. Purely additive:
 * `resolveSearchFields` still returns only source fields (the companion is
 * invisible to `$searchFields` overrides and to clients).
 */

import {
  resolveSearchFields,
  SEARCHABLE_ENUM_TYPES,
  type SearchFieldMeta,
  type SearchFieldResolutionOptions,
} from '@objectstack/spec/data';
import { SEARCH_COMPANION_FIELD, isCompanionMatchableTerm } from './search-companion.js';

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

function fieldClausesForTerm(field: string, term: string, meta: SearchFieldMeta): any[] {
  if (SEARCHABLE_ENUM_TYPES.has(meta?.type ?? '')) {
    const values = optionValuesMatching(meta, term);
    if (values.length > 0) return [{ [field]: { $in: values } }];
    return [{ [field]: { $contains: term } }];
  }
  return [{ [field]: { $contains: term } }];
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
  const hasCompanion = !!opts.fields[SEARCH_COMPANION_FIELD];
  const andClauses = terms.map((term) => {
    const clauses = searchFields.flatMap((f) => fieldClausesForTerm(f, term, opts.fields[f] || {}));
    if (hasCompanion && isCompanionMatchableTerm(term)) {
      clauses.push({ [SEARCH_COMPANION_FIELD]: { $contains: term.toLowerCase() } });
    }
    return { $or: clauses };
  });

  if (andClauses.length === 0) return null;
  return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
}
