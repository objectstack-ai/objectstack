// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Field-level predicate guard — anti filter-oracle (objectui#2251).
 *
 * FieldMasker strips unreadable fields from query RESULTS, but a caller can
 * still probe a hidden field's VALUE through predicates: filtering
 * `salary >= 100000` (or sorting / grouping by `salary`) changes which rows
 * come back even though the column itself is masked — presence/absence is
 * the oracle. The objectui `/data` surface (ADR-0055) makes arbitrary
 * URL-driven filters a first-class citizen, so this hole must be closed at
 * the engine, independent of anything the client sends.
 *
 * Policy: REJECT (403), never silently rewrite. Dropping predicates changes
 * query semantics unpredictably (removing an `$or` branch narrows results;
 * removing an `$and` branch widens them — the widening direction re-opens
 * the oracle). Salesforce FLS behaves the same way: querying a hidden field
 * is an error, not a silent no-op. The error message carries the offending
 * field names so authors can fix the query.
 *
 * Ordering contract: this guard MUST run against the CALLER-supplied AST,
 * before RLS filter injection — RLS policies legitimately reference fields
 * the caller cannot read (e.g. `owner_id`), and must not be rejected.
 */

import { PermissionDeniedError } from './errors.js';

interface FieldPermissionLike {
  readable?: boolean;
}

/** Logical keys of the FilterCondition grammar — never field names. */
const LOGICAL_KEYS = new Set(['$and', '$or', '$not']);

/**
 * Collect every field name referenced by a FilterCondition. Dotted paths
 * and nested-relation conditions gate on their FIRST segment / top-level
 * relation field — local field permissions govern local traversal.
 */
export function collectConditionFields(condition: unknown, out: Set<string> = new Set()): Set<string> {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return out;
  for (const [key, value] of Object.entries(condition as Record<string, unknown>)) {
    if (LOGICAL_KEYS.has(key)) {
      if (Array.isArray(value)) for (const sub of value) collectConditionFields(sub, out);
      else collectConditionFields(value, out);
      continue;
    }
    out.add(key.split('.')[0]);
  }
  return out;
}

/**
 * Collect every field referenced by the query's row-shaping clauses:
 * where / orderBy / groupBy / having / aggregations (field + FILTER).
 * `fields` (projection) is intentionally NOT collected — selecting a hidden
 * field is harmless because FieldMasker strips it from the result; only
 * predicates leak.
 *
 * `windowFunctions` was walked here too until the key was removed from
 * `QueryAST` (#4286) — the tombstone refuses it wherever the schema parses,
 * and no executor ever ran a window function off the query path, so there is
 * no clause left to leak through. `having` and `aggregations[].filter` stay
 * walked while they stay declared (#4286 leaves `having`'s enforce-or-remove
 * call open): this guard being ready is what makes enforcing them later safe.
 */
export function collectQueryFields(ast: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  collectConditionFields(ast.where, out);
  collectConditionFields(ast.having, out);

  const orderBy = ast.orderBy;
  if (Array.isArray(orderBy)) {
    for (const s of orderBy) {
      const field = (s as { field?: unknown })?.field;
      if (typeof field === 'string') out.add(field.split('.')[0]);
    }
  }

  const groupBy = ast.groupBy;
  if (Array.isArray(groupBy)) {
    for (const g of groupBy) {
      if (typeof g === 'string') out.add(g.split('.')[0]);
      else if (g && typeof g === 'object' && typeof (g as { field?: unknown }).field === 'string') {
        out.add(((g as { field: string }).field).split('.')[0]);
      }
    }
  }

  const aggregations = ast.aggregations;
  if (Array.isArray(aggregations)) {
    for (const a of aggregations) {
      const field = (a as { field?: unknown })?.field;
      if (typeof field === 'string' && field !== '*') out.add(field.split('.')[0]);
      collectConditionFields((a as { filter?: unknown })?.filter, out);
    }
  }

  return out;
}

/**
 * Throw PermissionDeniedError (→ HTTP 403) when the caller-supplied query
 * references a field its field-level permissions mark non-readable.
 */
export function assertReadableQueryFields(
  ast: Record<string, unknown>,
  fieldPermissions: Record<string, FieldPermissionLike>,
  object: string,
): void {
  const hidden = new Set(
    Object.entries(fieldPermissions)
      .filter(([, perm]) => perm && perm.readable === false)
      .map(([field]) => field),
  );
  if (hidden.size === 0) return;

  const offending = [...collectQueryFields(ast)].filter((f) => hidden.has(f));
  if (offending.length === 0) return;

  throw new PermissionDeniedError(
    `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: `
      + `${offending.join(', ')}. Filtering, sorting, grouping, or aggregating by a hidden field `
      + `would leak its values (filter oracle) — remove these predicates or grant field read access.`,
    { object, fields: offending, reason: 'field_predicate_denied' },
  );
}
