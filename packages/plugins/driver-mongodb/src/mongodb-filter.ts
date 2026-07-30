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

/**
 * Translate an ObjectStack `where` clause into a MongoDB filter document.
 *
 * The `where` clause can be:
 * 1. A FilterCondition object (MongoDB-style with `$` operators)
 * 2. A legacy array-style filter `[[field, op, value], 'or', [field, op, value]]`
 * 3. A plain key-value object for implicit equality
 */
export function translateFilter(where: unknown): Filter<any> {
  if (!where) return {};

  // Legacy array-style filters
  if (Array.isArray(where)) {
    return translateArrayFilter(where);
  }

  if (typeof where !== 'object') return {};

  return translateCondition(where as Record<string, unknown>);
}

/**
 * Translate a FilterCondition object to a MongoDB filter.
 */
function translateCondition(condition: Record<string, unknown>): Filter<any> {
  const mongoFilter: Record<string, unknown> = {};
  const andClauses: Filter<any>[] = [];

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case '$and':
        if (Array.isArray(value)) {
          andClauses.push({
            $and: value.map((sub) => translateCondition(sub as Record<string, unknown>)),
          });
        }
        break;

      case '$or':
        if (Array.isArray(value)) {
          andClauses.push({
            $or: value.map((sub) => translateCondition(sub as Record<string, unknown>)),
          });
        }
        break;

      case '$not':
        if (value && typeof value === 'object') {
          const inner = translateCondition(value as Record<string, unknown>);
          // MongoDB $not applies per-field; for top-level negation use $nor
          andClauses.push({ $nor: [inner] });
        }
        break;

      default:
        // Skip query-level keys that are not filter conditions
        if (['limit', 'offset', 'fields', 'orderBy'].includes(key)) continue;

        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          // Check if this is an operator object (has $ keys)
          const objValue = value as Record<string, unknown>;
          const hasOps = Object.keys(objValue).some((k) => k.startsWith('$'));
          if (hasOps) {
            mongoFilter[key] = translateFieldOperators(objValue);
          } else {
            // Nested object — treat as exact match
            mongoFilter[key] = value;
          }
        } else {
          // Implicit equality
          mongoFilter[key] = value;
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
 */
function translateFieldOperators(ops: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

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
      case '$exists':
        result[op] = value;
        break;

      case '$lte': {
        // A bare-day upper bound means "through that whole day" (#4042; the
        // driver-sql twin is #3777): `<= '2026-07-28'` compiles half-open
        // (`< '2026-07-29'`) so string-stored timestamps on the final day stay
        // in; order-equivalent to `<=` for plain `YYYY-MM-DD` date values.
        // (A BSON-Date-stored field never matched a string bound at all —
        // MongoDB type bracketing — which is a storage-form problem this
        // translation layer cannot fix; tracked separately from #4042.)
        const nextDay = nextUtcCalendarDay(value);
        if (nextDay != null) result.$lt = nextDay;
        else result.$lte = value;
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
          result.$gte = value[0];
          const betweenNextDay = nextUtcCalendarDay(value[1]);
          if (betweenNextDay != null) result.$lt = betweenNextDay;
          else result.$lte = value[1];
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
function translateArrayFilter(filters: unknown[]): Filter<any> {
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
      return translateComparison(filters[0], possibleOp, filters[2]);
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
        ? translateComparison(item[0], item[1], item[2])
        : translateArrayFilter(item);

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
function translateComparison(field: string, op: string, value: unknown): Filter<any> {
  const mappedField = mapFieldName(field);

  switch (op) {
    case '=':
    case 'eq':
      return { [mappedField]: value };
    case '!=':
    case '<>':
    case 'ne':
      return { [mappedField]: { $ne: value } };
    case '>':
    case 'gt':
      return { [mappedField]: { $gt: value } };
    case '>=':
    case 'gte':
      return { [mappedField]: { $gte: value } };
    case '<':
    case 'lt':
      return { [mappedField]: { $lt: value } };
    case '<=':
    case 'lte': {
      // Bare-day upper bound → half-open, `$lte`'s whole-day rule (#4042).
      const nextDay = nextUtcCalendarDay(value);
      return { [mappedField]: nextDay != null ? { $lt: nextDay } : { $lte: value } };
    }
    case 'in':
      return { [mappedField]: { $in: value as unknown[] } };
    case 'nin':
      return { [mappedField]: { $nin: value as unknown[] } };
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
