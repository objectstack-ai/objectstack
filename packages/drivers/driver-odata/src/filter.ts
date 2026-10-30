// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `where` → `$filter`: the pushdown translator.
 *
 * ## The one rule: never narrower
 *
 * The engine holds this driver behind its external-driver floor (objectql
 * `external-driver-floor.ts`): whatever the driver returns, the engine
 * re-applies the whole query in memory. So a `$filter` that matches MORE rows
 * than the `where` costs only transfer, and one that matches FEWER loses rows
 * no layer above can recover. Every translation here is therefore a SUPERSET
 * of the engine's reading, and anything that cannot be spelled as one is left
 * out — the result is `null` ("no constraint"), never a guess:
 *
 * - a member of `$and` that cannot be translated is dropped (the rest still
 *   narrows);
 * - an `$or` with any member that cannot be translated is dropped whole
 *   (dropping one branch of an `$or` would narrow it);
 * - `$not` is never pushed down. A service backed by SQL evaluates `not (P gt
 *   5)` under three-valued logic and drops the rows where `P` is null, which
 *   the engine's reading keeps — a narrowing the protocol text does not show.
 * - `$ne` / `$nin` on a nullable property carry `or P eq null`, for the same
 *   reason: a SQL-backed `P ne 5` drops null rows. `P eq null` is answered by
 *   `IS NULL` on every backend, so the disjunction is a superset under either
 *   reading.
 * - Comparisons on `Edm.String` are pushed down only where a case- or
 *   accent-insensitive collation can only WIDEN the answer (`eq`, `in`,
 *   `contains`, `startswith`, `endswith`): ordering (`gt`, `between`, …) and
 *   negation (`ne`, `nin`) on text are left to the engine, because a remote
 *   collation can order or equate strings differently from it.
 * - A comparand the dialect cannot spell as the property's EDM type (a date
 *   without its zone on a `DateTimeOffset`, text on an integer key) is left
 *   out rather than coerced.
 *
 * What is translated, on primitive and enum properties: `$eq`, `$ne`, `$gt`,
 * `$gte`, `$lt`, `$lte`, `$between`, `$in`, `$nin`, `$null`, `$contains`,
 * `$startsWith`, `$endsWith`, `$icontains`, combined with `$and` / `$or`.
 * Left to the engine: `$not`, `$notContains`, `$like` / `$ilike`, `$exists`,
 * field references (`{ $field }`), dotted paths, collection-valued and
 * complex properties, and any operator this list does not name.
 */

import type { EdmProperty, ODataDialect, ODataServiceModel } from './dialect.js';

/** How the translator reads one object: a field name → the property it names, and its spelling in a URL. */
export interface FilterTarget {
  model: ODataServiceModel;
  /** The remote property an engine field names, or `undefined` when it names none the translator may use. */
  propertyOf(field: string): EdmProperty | undefined;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

const ORDERING: Record<string, string> = { $gt: 'gt', $gte: 'ge', $lt: 'lt', $lte: 'le' };
const STRING_FUNCTIONS: Record<string, 'contains' | 'startswith' | 'endswith'> = {
  $contains: 'contains',
  $startsWith: 'startswith',
  $endsWith: 'endswith',
};

const and = (parts: string[]): string | null =>
  parts.length === 0 ? null : parts.length === 1 ? parts[0]! : parts.map((p) => `(${p})`).join(' and ');

/** A translated `where`. */
export interface TranslatedWhere {
  /** The `$filter` expression; `null` means "no constraint". */
  filter: string | null;
  /**
   * `true` when every predicate of the `where` reached the expression, so the
   * service's answer is the engine's (up to the service's own collation).
   * `false` when one was left to the engine and the expression is wider.
   */
  complete: boolean;
}

/**
 * Translate `where` into a `$filter` expression that selects a superset of
 * the rows it selects.
 */
export function translateWhere(where: unknown, target: FilterTarget, dialect: ODataDialect): TranslatedWhere {
  const state = { complete: true };
  const filter = translateCondition(where, target, dialect, state);
  return { filter, complete: state.complete };
}

interface TranslationState {
  complete: boolean;
}

/** Leave a predicate to the engine: no constraint here, and the translation is no longer complete. */
function leave(state: TranslationState): null {
  state.complete = false;
  return null;
}

function translateCondition(where: unknown, target: FilterTarget, dialect: ODataDialect, state: TranslationState): string | null {
  if (where === undefined || where === null) return null;
  if (!isPlainObject(where)) return leave(state);
  const parts: string[] = [];
  for (const [key, condition] of Object.entries(where)) {
    const part = translateEntry(key, condition, target, dialect, state);
    if (part !== null) parts.push(part);
  }
  return and(parts);
}

function translateEntry(
  key: string,
  condition: unknown,
  target: FilterTarget,
  dialect: ODataDialect,
  state: TranslationState,
): string | null {
  if (key === '$and') {
    if (!Array.isArray(condition)) return leave(state);
    return and(
      condition.map((member) => translateCondition(member, target, dialect, state)).filter((p): p is string => p !== null),
    );
  }
  if (key === '$or') {
    if (!Array.isArray(condition) || condition.length === 0) return leave(state);
    const members = condition.map((member) => translateCondition(member, target, dialect, state));
    if (members.some((m) => m === null)) return leave(state);
    return members.length === 1 ? members[0]! : members.map((m) => `(${m})`).join(' or ');
  }
  // `$not` and every other `$` key: left to the engine (see the module comment).
  if (key.startsWith('$')) return leave(state);

  const property = target.propertyOf(key);
  if (!property || property.isCollection) return leave(state);

  if (isPlainObject(condition) && Object.keys(condition).some((k) => k.startsWith('$'))) {
    const parts: string[] = [];
    for (const [op, comparand] of Object.entries(condition)) {
      const part = translateOperator(op, comparand, property, target, dialect);
      if (part === null) leave(state);
      else if (part !== TRUE) parts.push(part);
    }
    return and(parts);
  }
  const part = translateOperator('$eq', condition, property, target, dialect);
  return part === null ? leave(state) : part;
}

/** An operator whose translation is "no constraint" by its own meaning, not by a gap (`$nin: []`). */
const TRUE = 'true';

function translateOperator(
  op: string,
  comparand: unknown,
  property: EdmProperty,
  target: FilterTarget,
  dialect: ODataDialect,
): string | null {
  const name = property.name;
  const isText = property.type === 'Edm.String';
  // A field reference, a token object, a nested condition: never spelled.
  if (isPlainObject(comparand)) return null;
  const lit = (value: unknown) => dialect.literal(value, property.type, target.model);

  switch (op) {
    case '$eq': {
      const value = lit(comparand);
      return value === undefined ? null : `${name} eq ${value}`;
    }
    case '$ne': {
      if (isText || comparand === null) return comparand === null ? `${name} ne null` : null;
      const value = lit(comparand);
      if (value === undefined) return null;
      return property.nullable ? `${name} ne ${value} or ${name} eq null` : `${name} ne ${value}`;
    }
    case '$gt':
    case '$gte':
    case '$lt':
    case '$lte': {
      if (isText || comparand === null) return null;
      const value = lit(comparand);
      return value === undefined ? null : `${name} ${ORDERING[op]} ${value}`;
    }
    case '$between': {
      if (isText || !Array.isArray(comparand) || comparand.length !== 2) return null;
      const low = lit(comparand[0]);
      const high = lit(comparand[1]);
      if (low === undefined || high === undefined || comparand[0] === null || comparand[1] === null) return null;
      return `${name} ge ${low} and ${name} le ${high}`;
    }
    case '$in': {
      if (!Array.isArray(comparand)) return null;
      if (comparand.length === 0) return 'false';
      const values = comparand.map(lit);
      if (values.some((v) => v === undefined)) return null;
      return dialect.inList(name, values as string[]);
    }
    case '$nin': {
      if (Array.isArray(comparand) && comparand.length === 0) return TRUE;
      if (isText || !Array.isArray(comparand)) return null;
      const values = comparand.map(lit);
      if (values.some((v) => v === undefined) || comparand.some((v) => v === null)) return null;
      // `not` binds tighter than `eq` and `or`: without the parentheses `not P eq 1` reads as
      // `(not P) eq 1`, which a service refuses, and the nullable form's `or P eq null` would
      // fall under the `not` and drop the null rows.
      const excluded = `not (${dialect.inList(name, values as string[])})`;
      return property.nullable ? `${excluded} or ${name} eq null` : excluded;
    }
    case '$null': {
      if (comparand === true) return `${name} eq null`;
      if (comparand === false) return `${name} ne null`;
      return null;
    }
    case '$contains':
    case '$startsWith':
    case '$endsWith': {
      if (!isText || typeof comparand !== 'string') return null;
      return dialect.stringFunction(STRING_FUNCTIONS[op]!, name, lit(comparand)!);
    }
    case '$icontains': {
      // The engine folds ASCII case only. Over an ASCII comparand, `tolower` folds at least that
      // much, so the answer can only widen; a non-ASCII comparand could be folded by the remote
      // where the engine would not, and is left to the engine.
      if (!isText || typeof comparand !== 'string' || !/^[\x20-\x7E]*$/.test(comparand)) return null;
      return dialect.stringFunction('contains', dialect.toLower(name), lit(comparand.toLowerCase())!);
    }
    default:
      return null;
  }
}
