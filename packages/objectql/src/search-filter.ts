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
 * Field resolution (server-side, never client-trusted):
 *   1. an explicit, validated `requestedFields` subset (`$searchFields` override)
 *   2. the object's declared `searchableFields`
 *   3. an auto-default: the name/title field + short-text fields.
 *
 * Matching: case-insensitive; multiple whitespace-separated terms are AND-ed
 * (every term must hit some field); fields are OR-ed. `select`/`status` columns
 * store a value but users type the label, so the term is mapped to option
 * values whose label matches (with a raw-value `$contains` fallback).
 */

export interface SearchFieldMeta {
  type?: string;
  hidden?: boolean;
  options?: Array<{ label?: string; value: unknown } | string> | unknown;
}

export interface ExpandSearchOptions {
  /** The referenced object's field map (name → metadata). */
  fields: Record<string, SearchFieldMeta>;
  /** Object-declared `searchableFields` (the canonical default set). */
  searchableFields?: string[];
  /** Validated `$searchFields` override — intersected with the allowed set. */
  requestedFields?: string[];
  /** Preferred display field, placed first in the auto-default. */
  displayField?: string;
}

/** Short-text field types that make sense as `$contains` search targets. */
const TEXTUAL_TYPES = new Set(['text', 'email', 'phone', 'url', 'autonumber', 'textarea', 'markdown']);
/** Enumerated types searched by mapping the query to option values via labels. */
const ENUM_TYPES = new Set(['select', 'status']);
/** System / audit / heavy fields never auto-included. */
const EXCLUDED_FIELDS = new Set([
  'id', '_id', 'created', 'modified', 'created_at', 'updated_at',
  'created_by', 'updated_by', 'owner_id', 'organization_id', 'space', 'company_id',
]);
const EXCLUDED_TYPES = new Set([
  'json', 'object', 'grid', 'image', 'file', 'avatar', 'vector', 'location',
  'geometry', 'secret', 'password', 'encrypted', 'boolean', 'lookup', 'master_detail',
]);

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

function autoDefaultFields(fields: Record<string, SearchFieldMeta>, displayField?: string): string[] {
  const names = Object.keys(fields).filter((f) => {
    if (EXCLUDED_FIELDS.has(f)) return false;
    const meta = fields[f];
    if (!meta || meta.hidden) return false;
    const t = meta.type;
    if (!t) return false;
    if (EXCLUDED_TYPES.has(t)) return false;
    return TEXTUAL_TYPES.has(t) || ENUM_TYPES.has(t);
  });
  // Lead with the display/name field when present.
  const lead = displayField && fields[displayField] ? displayField
    : fields.name ? 'name'
    : fields.title ? 'title'
    : undefined;
  if (!lead) return names;
  return [lead, ...names.filter((f) => f !== lead)];
}

/** Resolve the effective searchable field set (server-side, validated). */
export function resolveSearchFields(opts: ExpandSearchOptions): string[] {
  const all = opts.fields || {};
  const declared = opts.searchableFields?.filter((f) => all[f]);
  const allowed = declared && declared.length > 0 ? declared : autoDefaultFields(all, opts.displayField);
  if (opts.requestedFields && opts.requestedFields.length > 0) {
    const allowSet = new Set(allowed);
    const validated = opts.requestedFields.filter((f) => allowSet.has(f));
    if (validated.length > 0) return validated;
  }
  return allowed;
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
  if (ENUM_TYPES.has(meta?.type ?? '')) {
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
  const andClauses = terms.map((term) => ({
    $or: searchFields.flatMap((f) => fieldClausesForTerm(f, term, opts.fields[f] || {})),
  }));

  if (andClauses.length === 0) return null;
  return andClauses.length === 1 ? andClauses[0] : { $and: andClauses };
}
