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
import { StandardErrorCode } from '@objectstack/spec/api';
import {
  coerceTemporalValue,
  type TemporalFieldKind,
  type TemporalFieldKindResolver,
} from './mongodb-temporal.js';

// ── [#5239] Boolean identities for the empty combinators ─────────────────────

/**
 * Keys that reach this translator inside a `where` object but describe the
 * QUERY rather than a predicate. The emitter has always skipped them; the
 * reduction below has to agree, or "what this node is worth as a boolean" and
 * "what this node emits" could disagree — which is the class of defect the
 * reduction exists to remove.
 */
const QUERY_LEVEL_KEYS = new Set(['limit', 'offset', 'fields', 'orderBy']);

/**
 * A MongoDB query document that matches NO document, for the `false` verdict.
 *
 * `$in: []` is empty-set membership — no value satisfies it, on every server
 * version, with no dependence on a collection's fields. `_id` is the one field
 * MongoDB guarantees exists. This is the shape #5239 names, and it is emitted
 * as a REAL condition: `$or: []` must reach `find` / `updateMany` /
 * `deleteMany` as "zero rows", never as the absent filter `{}`, which those
 * three read as "every document".
 */
function matchNothing(): Filter<any> {
  return { _id: { $in: [] } };
}

/**
 * [#5239, mirroring #5134] What a filter node is worth as a boolean, decided
 * BEFORE any query document is built.
 *
 * - `'true'`  — matches every document; the translator emits no condition.
 * - `'false'` — matches no document; the translator emits {@link matchNothing}.
 * - `'clause'` — carries at least one real predicate; translate it normally.
 */
type FilterVerdict = 'true' | 'false' | 'clause';

/**
 * [#5239] Is `value` a Filter Protocol NODE — the shape `FilterConditionSchema`
 * declares for every element of `$and`/`$or` and for the operand of `$not`?
 *
 * The PROTOTYPE check is the load-bearing half. The identity reduction turns
 * "this node has no predicates" into "matches every document", so any object
 * whose own enumerable keys are empty reads as TRUE. A `Date`, a `RegExp`, a
 * `Map` or a class instance all satisfy `typeof x === 'object' &&
 * !Array.isArray(x)` while enumerating to nothing — accepting them would
 * PROMOTE garbage from "silently mistranslated" to "matches all documents",
 * which on `deleteMany` is not a wrong row count but data loss. Measured on
 * `main` before this change: `{ $or: [new Date()] }` translated to
 * `{ $or: [{}] }`, i.e. every document, and `{ $or: 'x' }` / `{ $not: null }`
 * translated to `{}`, likewise every document.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** A short type name for an operand the translator refuses. */
function describeFilterOperand(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind !== 'object') return kind;
  const ctor = (value as { constructor?: { name?: string } }).constructor;
  return ctor?.name && ctor.name !== 'Object' ? ctor.name : 'object';
}

/** A short, non-throwing rendering of an offending operand for the message. */
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
 * [#5239] The ADR-0112 envelope this driver's filter refusals speak, matching
 * `driver-sql`'s `unsupportedFilterError` exactly: one condition — "this filter
 * cannot run" — carries one wire code however the caller reached it, and
 * `status: 400` keeps a caller's mistake off the unhandled-server-error path.
 *
 * The `[mongodb]` prefix is deliberately absent from the text: driver-internal
 * wording does not belong on the wire (#3867).
 */
function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#5239] The gate that gives "this group translated to empty" exactly ONE
 * cause.
 *
 * Identity reduction is sound only once an empty group can mean "the author
 * wrote an empty group" and nothing else. Refusing non-nodes here — before any
 * identity is applied — is what makes the reduction safe rather than a
 * promotion of garbage to match-all. Same discipline as #5134 in `driver-sql`
 * and cloud#1073 in Turso's `RemoteTransport.buildWhereSQL`.
 */
function assertFilterNode(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (isFilterNode(value)) return;
  throw unsupportedFilterError(
    `Filter node at ${path} is a ${describeFilterOperand(value)} (${safeShapePreview(value)}), not a filter ` +
      `condition object. Every element of "$and"/"$or" and the operand of "$not" must be a plain object of ` +
      `field constraints (e.g. { "status": "active" }) or nested combinators — @objectstack/spec ` +
      `FilterConditionSchema declares this position as a FilterCondition. It is refused rather than skipped ` +
      `because skipping it would silently change which documents match.`,
  );
}

/** [#5239] `$and`/`$or` take a list; anything else is refused, never coerced. */
function assertFilterNodeList(value: unknown, key: string, path: string): asserts value is unknown[] {
  if (Array.isArray(value)) return;
  throw unsupportedFilterError(
    `Filter combinator "${key}" at ${path} requires an array of filter conditions, but received a ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). @objectstack/spec FilterConditionSchema ` +
      `declares "${key}" as FilterCondition[].`,
  );
}

/**
 * [#5239] Reduce one filter node to its boolean verdict, validating shapes on
 * the way down.
 *
 * A node is the AND of its entries, so FALSE dominates and a node with no
 * entries at all is TRUE (the empty conjunction) — which is why `{}` is a TRUE
 * disjunct inside `$or` and why `{ $not: {} }` is FALSE.
 *
 * The walk does NOT short-circuit: a `$or: []` sibling must not stop it from
 * reaching — and refusing — a malformed node further along, or the shape gate
 * would depend on key order.
 *
 * Deciding STRUCTURALLY, rather than translating and then asking whether the
 * emitted document came out empty, is the point. "Nothing was emitted" cannot
 * distinguish "the author wrote an empty group" from "something failed to
 * translate"; a structural verdict has no such blind spot.
 */
function reduceFilterNode(node: Record<string, unknown>, path: string): FilterVerdict {
  let sawFalse = false;
  let sawClause = false;
  for (const [key, value] of Object.entries(node)) {
    const verdict = reduceFilterKey(key, value, path);
    if (verdict === 'false') sawFalse = true;
    else if (verdict === 'clause') sawClause = true;
  }
  return sawFalse ? 'false' : sawClause ? 'clause' : 'true';
}

/** [#5239] The verdict of ONE key of a filter node. */
function reduceFilterKey(key: string, value: unknown, path: string): FilterVerdict {
  const here = path ? `${path}.${key}` : key;

  if (key === '$and' || key === '$or') {
    assertFilterNodeList(value, key, here);
    let sawTrue = false;
    let sawFalse = false;
    let sawClause = false;
    value.forEach((element, index) => {
      const elementPath = `${here}[${index}]`;
      assertFilterNode(element, elementPath);
      const verdict = reduceFilterNode(element, elementPath);
      if (verdict === 'true') sawTrue = true;
      else if (verdict === 'false') sawFalse = true;
      else sawClause = true;
    });
    // `$and: []` → no FALSE, no clause → TRUE (the AND identity).
    if (key === '$and') return sawFalse ? 'false' : sawClause ? 'clause' : 'true';
    // `$or: []` → no TRUE, no clause → FALSE (the OR identity). MongoDB itself
    // answers neither: it rejects the empty array outright
    // (`$and/$or/$nor must be a nonempty array`), so this filter used to be a
    // 500-shaped throw rather than a verdict.
    return sawTrue ? 'true' : sawClause ? 'clause' : 'false';
  }

  if (key === '$not') {
    assertFilterNode(value, here);
    const inner = reduceFilterNode(value, here);
    // NOT TRUE ≡ FALSE — so `{ $not: {} }` matches nothing.
    return inner === 'true' ? 'false' : inner === 'false' ? 'true' : 'clause';
  }

  // Query-level keys carry no predicate; the emitter skips them and so does the
  // verdict, so the two never disagree about what this node is worth.
  if (QUERY_LEVEL_KEYS.has(key)) return 'true';

  // A field key always contributes a predicate. This stays `'clause'` even for
  // `{ field: {} }` (a field constrained by zero operators), which this
  // translator emits as `{ field: {} }` — an exact-match on an empty document.
  // That shape is a SEPARATE divergence with three answers across the repo,
  // ruled REJECT in #5240 but not yet gated in any backend; classifying it as
  // `'clause'` rather than `'true'` is precisely what keeps this change from
  // silently ruling on it.
  return 'clause';
}

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

  // [#5239] Shape gate + structural reduction FIRST, over the WHOLE tree. Only
  // a `'clause'` node reaches the emitter, so `translateCondition` never has to
  // ask whether what it built came out empty.
  const node = where as Record<string, unknown>;
  const verdict = reduceFilterNode(node, 'filter');
  if (verdict === 'true') return {};
  if (verdict === 'false') return matchNothing();

  return translateCondition(node, temporalKind, 'filter');
}

/**
 * Translate a FilterCondition object to a MongoDB filter.
 *
 * [#5239] Every combinator key is decided by {@link reduceFilterKey} BEFORE
 * anything is emitted, so an empty group is applied as its boolean IDENTITY
 * rather than dropped: a `'true'` key contributes nothing to the node's AND, a
 * `'false'` key contributes {@link matchNothing}, and only `'clause'` members
 * are translated. That is why every `$and`/`$or` array this function emits is
 * guaranteed non-empty — MongoDB rejects an empty one, and the old code handed
 * it straight through.
 */
function translateCondition(
  condition: Record<string, unknown>,
  temporalKind?: TemporalFieldKindResolver,
  path = 'filter',
): Filter<any> {
  const mongoFilter: Record<string, unknown> = {};
  const andClauses: Filter<any>[] = [];

  for (const [key, value] of Object.entries(condition)) {
    switch (key) {
      case '$and':
      case '$or': {
        const here = `${path}.${key}`;
        const keyVerdict = reduceFilterKey(key, value, path);
        // TRUE is the AND identity for the node — it adds no condition. FALSE
        // makes the node match nothing.
        if (keyVerdict === 'true') break;
        if (keyVerdict === 'false') {
          andClauses.push(matchNothing());
          break;
        }
        // `'clause'` guarantees at least one branch survives: a TRUE member
        // would have made a `$or` TRUE, a FALSE member would have made a `$and`
        // FALSE, and both were handled above. Dropping the identity members is
        // what makes `{ $or: [{ a: 'x' }, { $or: [] }] }` mean `a = x` rather
        // than an empty `$or` MongoDB refuses.
        const branches = (value as unknown[])
          .map((sub, index) => ({ sub: sub as Record<string, unknown>, index }))
          .filter(({ sub, index }) => reduceFilterNode(sub, `${here}[${index}]`) === 'clause')
          .map(({ sub, index }) => translateCondition(sub, temporalKind, `${here}[${index}]`));
        andClauses.push(key === '$and' ? { $and: branches } : { $or: branches });
        break;
      }

      case '$not': {
        const keyVerdict = reduceFilterKey(key, value, path);
        // NOT FALSE ≡ TRUE — no condition. NOT TRUE ≡ FALSE — zero documents.
        if (keyVerdict === 'true') break;
        if (keyVerdict === 'false') {
          andClauses.push(matchNothing());
          break;
        }
        const inner = translateCondition(
          value as Record<string, unknown>,
          temporalKind,
          `${path}.$not`,
        );
        // MongoDB $not applies per-field; for top-level negation use $nor
        andClauses.push({ $nor: [inner] });
        break;
      }

      default:
        // Skip query-level keys that are not filter conditions
        if (QUERY_LEVEL_KEYS.has(key)) continue;

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
