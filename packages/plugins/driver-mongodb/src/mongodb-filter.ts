// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MongoDB Filter Translator
 *
 * Converts ObjectStack FilterCondition / AST-style `where` clauses into
 * native MongoDB filter documents.
 *
 * Supports:
 * - Implicit equality: `{ field: value }`
 * - Explicit operators: `{ field: { $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin } }`
 * - String operators: `{ field: { $contains, $startsWith, $endsWith, $notContains } }`
 * - Special: `{ field: { $null, $exists } }`
 * - Logical: `{ $and, $or, $not }`
 * - Range: `{ field: { $between: [min, max] } }`
 * - Legacy array-style: `[field, op, value]`
 */

import type { Filter } from 'mongodb';
import { nextUtcCalendarDay } from '@objectstack/core';
import { coerceTemporalValue, type TemporalFieldKindResolver } from './mongodb-temporal.js';

/**
 * Translate an ObjectStack `where` clause into a MongoDB filter document.
 *
 * The `where` clause can be:
 * 1. A FilterCondition object (MongoDB-style with `$` operators)
 * 2. A legacy array-style filter `[[field, op, value], 'or', [field, op, value]]`
 * 3. A plain key-value object for implicit equality
 *
 * `temporalKind` resolves the declared temporal type of a field so comparands
 * land in the column's storage form (#4047) — a `Field.datetime` comparand
 * becomes a BSON `Date`, because MongoDB compares across BSON types by type
 * bracket and a string comparand matches no Date row at all. Omitting it keeps
 * the pure shape translation, which is what the standalone export is for.
 */
export function translateFilter(
  where: unknown,
  temporalKind?: TemporalFieldKindResolver,
): Filter<any> {
  if (!where) return {};

  // Legacy array-style filters
  if (Array.isArray(where)) {
    return translateArrayFilter(where, temporalKind);
  }

  if (typeof where !== 'object') return {};

  return translateCondition(where as Record<string, unknown>, temporalKind);
}

/**
 * Translate a FilterCondition object to a MongoDB filter.
 */
function translateCondition(
  condition: Record<string, unknown>,
  temporalKind?: TemporalFieldKindResolver,
): Filter<any> {
  const mongoFilter: Record<string, unknown> = {};
  const andClauses: Filter<any>[] = [];

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case '$and':
        if (Array.isArray(value)) {
          andClauses.push({
            $and: value.map((sub) => translateCondition(sub as Record<string, unknown>, temporalKind)),
          });
        }
        break;

      case '$or':
        if (Array.isArray(value)) {
          andClauses.push({
            $or: value.map((sub) => translateCondition(sub as Record<string, unknown>, temporalKind)),
          });
        }
        break;

      case '$not':
        if (value && typeof value === 'object') {
          const inner = translateCondition(value as Record<string, unknown>, temporalKind);
          // MongoDB $not applies per-field; for top-level negation use $nor
          andClauses.push({ $nor: [inner] });
        }
        break;

      default:
        // Skip query-level keys that are not filter conditions
        if (['limit', 'offset', 'fields', 'orderBy'].includes(key)) continue;

        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          // Check if this is an operator object (has $ keys)
          const objValue = value as Record<string, unknown>;
          const hasOps = Object.keys(objValue).some((k) => k.startsWith('$'));
          if (hasOps) {
            mongoFilter[key] = translateFieldOperators(objValue, temporalKind?.(key));
          } else {
            // Nested object — treat as exact match
            mongoFilter[key] = value;
          }
        } else {
          // Implicit equality
          mongoFilter[key] = coerceTemporalValue(value, temporalKind?.(key));
        }
    }
  }

  if (andClauses.length > 0) {
    if (Object.keys(mongoFilter).length > 0) {
      return { $and: [mongoFilter, ...andClauses] };
    }
    if (andClauses.length === 1) {
      return andClauses[0];
    }
    return { $and: andClauses };
  }

  return mongoFilter;
}

/**
 * Translate ObjectStack field-level operators into MongoDB operators.
 *
 * `kind` is the declared temporal type of the field these operators apply to,
 * so each comparand lands in the field's storage form (#4047). Order matters
 * and is load-bearing: the calendar-day upper-bound rewrite (#3777/#4042) runs
 * on the STRING first — it is a calendar operation — and only the resulting
 * bound is converted to the storage form. Converting first would leave
 * `nextUtcCalendarDay` a `Date` it correctly refuses to widen.
 */
function translateFieldOperators(
  ops: Record<string, unknown>,
  kind?: 'datetime' | 'date',
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const store = (v: unknown) => coerceTemporalValue(v, kind);

  for (const [op, value] of Object.entries(ops)) {
    switch (op) {
      // Direct mappings (ObjectStack → MongoDB are identical)
      case '$eq':
      case '$ne':
      case '$gt':
      case '$gte':
      case '$lt':
      case '$in':
      case '$nin':
        result[op] = store(value);
        break;

      // Value-independent — a presence predicate takes a boolean, not a
      // comparand, so it is never coerced.
      case '$exists':
        result[op] = value;
        break;

      case '$lte': {
        // A bare-day upper bound means "through that whole day" (#4042; the
        // driver-sql twin is #3777): `<= '2026-07-28'` compiles half-open
        // (`< '2026-07-29'`) so instants on the final day stay in;
        // order-equivalent to `<=` for plain `YYYY-MM-DD` date values.
        const nextDay = nextUtcCalendarDay(value);
        if (nextDay != null) result.$lt = store(nextDay);
        else result.$lte = store(value);
        break;
      }

      // String operators → $regex
      case '$contains':
        result.$regex = escapeRegex(String(value));
        result.$options = 'i';
        break;

      case '$notContains':
        result.$not = { $regex: escapeRegex(String(value)), $options: 'i' };
        break;

      case '$startsWith':
        result.$regex = `^${escapeRegex(String(value))}`;
        result.$options = 'i';
        break;

      case '$endsWith':
        result.$regex = `${escapeRegex(String(value))}$`;
        result.$options = 'i';
        break;

      // Range operator → $gte + upper bound (half-open on a bare-day max,
      // inheriting `$lte`'s whole-day rule — #4042)
      case '$between':
        if (Array.isArray(value) && value.length === 2) {
          result.$gte = store(value[0]);
          const betweenNextDay = nextUtcCalendarDay(value[1]);
          if (betweenNextDay != null) result.$lt = store(betweenNextDay);
          else result.$lte = store(value[1]);
        }
        break;

      // Null check
      case '$null':
        if (value === true) {
          result.$eq = null;
        } else {
          result.$ne = null;
        }
        break;

      default:
        // Reject unknown operators instead of passing them through (P0). Keys
        // like `$where` / `$function` / `$expr` / `$accumulator` would reach
        // MongoDB and execute server-side JavaScript or bypass query intent.
        // Every legitimate ObjectQL field operator is allowlisted above.
        throw new Error(`[mongodb] unsupported filter operator '${op}'`);
    }
  }

  return result;
}

/**
 * Translate legacy array-style filters into a MongoDB filter.
 *
 * Array format: `[[field, op, value], 'or', [field, op, value], ...]`
 * Nested arrays are treated as grouped conditions.
 */
function translateArrayFilter(
  filters: unknown[],
  temporalKind?: TemporalFieldKindResolver,
): Filter<any> {
  if (filters.length === 0) return {};

  // Check if this is a single comparison tuple: [field, op, value]
  if (
    filters.length === 3 &&
    typeof filters[0] === 'string' &&
    typeof filters[1] === 'string' &&
    !Array.isArray(filters[0]) &&
    (typeof filters[2] !== 'object' || filters[2] === null || Array.isArray(filters[2]))
  ) {
    // Only treat as tuple if filters[1] looks like an operator (not another field name
    // that could be part of a nested array filter)
    const possibleOp = filters[1] as string;
    const isOperator = ['=', '!=', '<>', '>', '>=', '<', '<=', 'in', 'nin', 'eq', 'ne',
      'gt', 'gte', 'lt', 'lte', 'contains', 'like'].includes(possibleOp) || possibleOp.startsWith('$');
    if (isOperator) {
      return translateComparison(filters[0], possibleOp, filters[2], temporalKind);
    }
  }

  // Parse mixed array of conditions and logical connectors
  const groups: { logic: 'and' | 'or'; filter: Filter<any> }[] = [];
  let nextLogic: 'and' | 'or' = 'and';

  for (const item of filters) {
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (lower === 'or') nextLogic = 'or';
      else if (lower === 'and') nextLogic = 'and';
      continue;
    }

    if (Array.isArray(item)) {
      // Could be a comparison tuple or a nested group
      const isTuple =
        item.length === 3 &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'string' &&
        !Array.isArray(item[2]);

      const translated = isTuple
        ? translateComparison(item[0], item[1], item[2], temporalKind)
        : translateArrayFilter(item, temporalKind);

      groups.push({ logic: nextLogic, filter: translated });
      nextLogic = 'and';
    }
  }

  if (groups.length === 0) return {};
  if (groups.length === 1) return groups[0].filter;

  // Check if all are AND
  const hasOr = groups.some((g) => g.logic === 'or');
  if (!hasOr) {
    return { $and: groups.map((g) => g.filter) };
  }

  // Build $or groups: consecutive AND conditions are grouped together
  const orGroups: Filter<any>[][] = [[]];
  for (const g of groups) {
    if (g.logic === 'or') {
      orGroups.push([g.filter]);
    } else {
      orGroups[orGroups.length - 1].push(g.filter);
    }
  }

  const orClauses = orGroups.map((group) => {
    if (group.length === 1) return group[0];
    return { $and: group };
  });

  if (orClauses.length === 1) return orClauses[0];
  return { $or: orClauses };
}

/**
 * Translate a single comparison `[field, operator, value]` tuple.
 */
function translateComparison(
  field: string,
  op: string,
  value: unknown,
  temporalKind?: TemporalFieldKindResolver,
): Filter<any> {
  const mappedField = mapFieldName(field);
  // Resolve against the MAPPED name: `createdAt` is an alias of the declared
  // `created_at`, and the field kinds are indexed under declared names.
  const store = (v: unknown) => coerceTemporalValue(v, temporalKind?.(mappedField));

  switch (op) {
    case '=':
    case 'eq':
      return { [mappedField]: store(value) };
    case '!=':
    case '<>':
    case 'ne':
      return { [mappedField]: { $ne: store(value) } };
    case '>':
    case 'gt':
      return { [mappedField]: { $gt: store(value) } };
    case '>=':
    case 'gte':
      return { [mappedField]: { $gte: store(value) } };
    case '<':
    case 'lt':
      return { [mappedField]: { $lt: store(value) } };
    case '<=':
    case 'lte': {
      // Bare-day upper bound → half-open, `$lte`'s whole-day rule (#4042).
      // Calendar first, storage form second — see translateFieldOperators.
      const nextDay = nextUtcCalendarDay(value);
      return {
        [mappedField]: nextDay != null ? { $lt: store(nextDay) } : { $lte: store(value) },
      };
    }
    case 'in':
      return { [mappedField]: { $in: store(value) as unknown[] } };
    case 'nin':
      return { [mappedField]: { $nin: store(value) as unknown[] } };
    case 'contains':
    case 'like':
      return { [mappedField]: { $regex: escapeRegex(String(value)), $options: 'i' } };
    default:
      // Pass through for any standard MongoDB operator
      return { [mappedField]: { [`$${op}`]: value } };
  }
}

/**
 * Map common ObjectStack field name aliases.
 */
function mapFieldName(field: string): string {
  if (field === 'createdAt') return 'created_at';
  if (field === 'updatedAt') return 'updated_at';
  return field;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
