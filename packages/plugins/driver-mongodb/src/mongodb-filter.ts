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
  return unsupportedFilterError(
    `A filter ARRAY reached the driver: ${JSON.stringify(filters)}. ` +
    `'where' is a FilterCondition object; the array form ('FilterArray') is input-only ` +
    `authoring sugar and is lowered by @objectstack/spec parseFilterAST() at the engine ` +
    `and protocol doors before any driver sees it (#5158). This driver no longer carries a ` +
    `second compiler for it — call through ObjectQL, or lower the value yourself with ` +
    `parseFilterAST(). Note the INFIX join form ([condA, "or", condB]) has no lowering at ` +
    `all: write the prefix form ["or", condA, condB].`,
  );
}

/**
 * [#4436 / #5240] A filter this driver cannot evaluate, in the ADR-0112
 * envelope every sibling filter refusal across the backends speaks.
 *
 * Extracted from {@link filterArrayReachedDriverError}, which built the same
 * `INVALID_FILTER` / 400 error inline — it was this package's only refusal
 * carrying a wire identity, so there was nothing to share it with until #5347
 * added a second. It is deliberately the SAME envelope as `driver-sql`'s and
 * `driver-memory`'s `unsupportedFilterError`, not a third: #3948 made the
 * backends agree that an uncompilable filter is a refusal, and a suite that
 * swaps one driver for another must see one `400 INVALID_FILTER`, not a coded
 * refusal on three backends and a bare `{ error }` on the fourth.
 *
 * Note what this does NOT do: the `default:` arm of {@link translateFieldOperators}
 * still throws a bare `Error` with a `[mongodb]` prefix, outside this envelope.
 * That is #5346's, filed and measured separately — converting it here would be
 * an unrelated behaviour change riding on #5347.
 */
function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#5347] `$null` whose comparand is not a boolean.
 *
 * The leading sentence is `driver-sql`'s, verbatim — one condition, one wording
 * (#5240) — and the tail records the measurement that made the refusal the
 * ruling: on one row with `stage: 'won'` and one with `stage: null`,
 * `{ stage: { $null: 'yes' } }` returned the NULL row on driver-sql /
 * driver-sqlite-wasm / Turso local, the VALUED row here and on driver-memory's
 * query path, and BOTH rows through driver-memory's reference matcher. Three
 * readings of one declared operator, none of them anyone's decision — just what
 * a two-branch conditional does with a third value.
 */
function nonBooleanNullComparandError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$null" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
      `than coerced because the backends read a non-boolean in OPPOSITE directions — driver-sql ` +
      `compiled IS NULL (anything but false), this driver and driver-memory's query path ` +
      `compiled IS NOT NULL (anything but true), and driver-memory's matcher dropped the ` +
      `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
      `the false it was written to mean (#5347).`,
  );
}

/** A short type name for an operand a filter refusal has to describe. */
function describeFilterOperand(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind !== 'object') return kind;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name !== 'Object' ? ctor.name : 'object';
}

/** A short, non-throwing rendering of an offending value for a message. */
function safeShapePreview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return typeof value;
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return typeof value;
  }
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

  return translateCondition(where as Record<string, unknown>, temporalKind, 'filter');
}

/**
 * Translate a FilterCondition object to a MongoDB filter.
 */
function translateCondition(
  condition: Record<string, unknown>,
  temporalKind?: TemporalFieldKindResolver,
  // [#5347] Where in the filter tree this node sits, so a refusal can name the
  // position it refused — the same `filter.$or[0].stage` spelling driver-sql
  // and driver-memory print.
  path = 'filter',
): Filter<any> {
  const mongoFilter: Record<string, unknown> = {};
  const andClauses: Filter<any>[] = [];

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case '$and':
        if (Array.isArray(value)) {
          andClauses.push({
            $and: value.map((sub, i) => translateCondition(sub as Record<string, unknown>, temporalKind, `${path}.$and[${i}]`)),
          });
        }
        break;

      case '$or':
        if (Array.isArray(value)) {
          andClauses.push({
            $or: value.map((sub, i) => translateCondition(sub as Record<string, unknown>, temporalKind, `${path}.$or[${i}]`)),
          });
        }
        break;

      case '$not':
        if (value && typeof value === 'object') {
          const inner = translateCondition(value as Record<string, unknown>, temporalKind, `${path}.$not`);
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
            mongoFilter[key] = translateFieldOperators(objValue, temporalKind?.(key), key, `${path}.${key}`);
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
  // [#5347] Carried only so a refusal can name the field and the position it
  // refused, the way `driver-sql` and `driver-memory` do.
  field = '<field>',
  path = 'filter',
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
      //
      // [#5347] The arm used to be a two-branch `if/else` on `value === true`,
      // so EVERY non-boolean comparand fell to the `else` and translated to
      // `$ne: null` — IS NOT NULL. `driver-sql` hung its default on the
      // opposite side (`opValue === false` → IS NULL) and `driver-memory`'s
      // reference matcher on neither (the constraint vanished), so one declared
      // operator had three readings across four backends. Ruled REFUSED on
      // #5347: `FieldOperatorsSchema` declares `$null: z.boolean()`, and there
      // is no reading of a non-boolean here that is not a guess at intent.
      case '$null':
        if (typeof value !== 'boolean') throw nonBooleanNullComparandError(field, value, `${path}.$null`);
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
