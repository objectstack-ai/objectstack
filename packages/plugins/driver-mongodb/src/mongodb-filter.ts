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
 *
 * NOT supported, deliberately: the legacy ARRAY spelling (`[field, op, value]`,
 * `[[…], 'or', […]]`). `where` is a `FilterCondition` object by declaration, and
 * `FilterArray` is INPUT-ONLY authoring sugar lowered through `parseFilterAST`
 * at the engine and protocol doors before any driver is reached (#5158, ruling
 * C). A second compiler for it here is the divergence ADR-0053 D-A1 forbids —
 * it is refused loudly instead, matching driver-sql, driver-memory and cloud's
 * `RemoteTransport.buildWhereSQL`.
 */

import type { Filter } from 'mongodb';
import { nextUtcCalendarDay } from '@objectstack/core';
import { StandardErrorCode } from '@objectstack/spec/api';
import {
  coerceTemporalValue,
  type TemporalFieldKind,
  type TemporalFieldKindResolver,
} from './mongodb-temporal.js';

/**
 * [#5158] A `FilterArray` reached the driver unlowered — the twin of
 * `driver-sql`'s and `driver-memory`'s `filterArrayReachedDriverError`, word
 * for word so the three backends answer one condition with one wording, in the
 * ADR-0112 envelope (`400 INVALID_FILTER`) every sibling filter refusal speaks.
 */
function filterArrayReachedDriverError(filters: unknown[]): Error {
  const err = new Error(
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
    `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
    `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
    `and protocol doors before any driver sees it (#5158). This driver no longer carries a ` +
    `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
    `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
    `all: write the prefix form ["or", condA, condB].`,
  ) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * Translate an ObjectStack `where` clause into a MongoDB filter document.
 *
 * The `where` clause can be:
 * 1. A FilterCondition object (MongoDB-style with `$` operators)
 * 2. A plain key-value object for implicit equality
 *
 * An ARRAY is refused (#5158) — see the module header.
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

  if (Array.isArray(where)) {
    // `[]` still means "no filter" — unchanged.
    if (where.length === 0) return {};
    throw filterArrayReachedDriverError(where);
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
  // The shared type, not a hand-copy of its members. This signature spelled
  // the union out literally, so widening the canon to include `time`
  // (ADR-0053 D-C1) left the two out of step and the call site stopped
  // compiling. One definition means the next temporal type is added once.
  kind?: TemporalFieldKind,
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
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
