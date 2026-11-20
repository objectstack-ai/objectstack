// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D2, D4] What `driver-sql`'s filter compiler and the Turso remote
 * transport's compiler share for a FIXED-READ LEAF (`@objectstack/spec/data`'s
 * `isFixedReadLeaf`: `SharedRecordIds` today): the walk that finds a leaf no
 * compiler here compiles, and the predicates of the fixed inner read the leaf
 * describes. Each compiler builds its own SQL from them, every value bound,
 * ⛔ never spliced into the statement.
 *
 * ## Where a leaf compiles
 *
 * Only as the comparand of `$in` in a field's operator map,
 * `{ field: { $in: leaf } }`: at any depth under `$and`, `$or` and `$not`, and
 * inside the composed scope of a `ReadableIds` leaf. There it compiles to
 * `field IN (SELECT column FROM table WHERE …)`, one statement, so `find`,
 * `count` and `aggregate` agree by construction and a record matched by several
 * rows of the table is one row (ADR-0155 D1: ⛔ no `EXISTS`, no correlated
 * form, no join).
 *
 * Anywhere else (under another operator, as a field's bare value, as a list
 * member, as a combinator's operand, as a node) the leaf is a composition
 * fault, refused with ADR-0139 D3's envelope, `INTERNAL_ERROR` / 500
 * (`@objectstack/core`'s `refuseFixedReadLeafOnce`). ⛔ It is never read as an
 * ordinary comparand. The engine's seam places every leaf (ADR-0155 D1, D4);
 * this walk is the compiler's own floor under that seam, for a caller that
 * reached the driver another way.
 *
 * ## The inner read
 *
 * {@link fixedInnerReadPredicates} turns the leaf's own description
 * (`fixedInnerReadOf`) into predicates, so ⛔ no compiler restates a leaf's
 * predicate by hand:
 *
 *  - each `equals` entry as `column = ?`, each `memberOf` entry as
 *    `column IN (?, …)`;
 *  - the blank-id guard, `column IS NOT NULL AND column <> ''`, so a negation
 *    (`NOT (id IN (…))`) answers every row the set does not hold. On a dialect
 *    that stores the empty string as NULL (Oracle) `<> ''` is `<> NULL`, which
 *    is never true and would empty the set, so the half is omitted there:
 *    `IS NOT NULL` already excludes the empty id;
 *  - **no tenant scope** (`tenantScope: 'none'`, ADR-0155 ① ruled A): ⛔ the
 *    compiler applies none to the inner read. The outer statement's wall is
 *    untouched.
 *
 * `index.ts` re-exports this module for `@objectstack/driver-turso`.
 */

import { describeFixedReadLeaf } from '@objectstack/core';
import { fixedInnerReadOf, isComposedReadableIds, isFixedReadLeaf } from '@objectstack/spec/data';
import type { FixedInnerRead, FixedReadLeaf } from '@objectstack/spec/data';

/** A fixed-read leaf the walk found where no compiler compiles one. */
export interface MisplacedFixedReadLeaf {
  /** Where it sits, as a path from the `where` root (`where.owner.$eq`). */
  readonly at: string;
  /** The leaf itself, for `describeFixedReadLeaf`. */
  readonly leaf: unknown;
}

/** Is `value` a plain object or a list: something a filter is built from and the walk descends into? */
function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * [ADR-0155 D1] The first fixed-read leaf in `where` that sits anywhere but as
 * the `$in` comparand of a field's operator map, or `null` when every leaf
 * sits there (or there is none).
 *
 * The walk reads roles, not just keys: a NODE's keys are combinators and field
 * names, an OPERATOR MAP's keys are operators, and only an operator map's `$in`
 * holds a leaf. A composed `ReadableIds` leaf's scope is a node, walked with
 * the same rules, and so is the scope of any value `scopeOf` answers for (a
 * compiler's own resolved form of that leaf, such as the Turso remote
 * transport's semi-join). A value that is neither a plain object nor a list (a
 * `Date`, a buffer) holds no leaf. Cycles are cut on the current path.
 */
export function findMisplacedFixedReadLeaf(
  where: unknown,
  path = 'where',
  scopeOf: (value: unknown) => { readonly scope: unknown } | null = () => null,
): MisplacedFixedReadLeaf | null {
  const onPath = new Set<object>();
  const descend = <T>(value: object, walk: () => T): T | null => {
    if (onPath.has(value)) return null;
    onPath.add(value);
    try {
      return walk();
    } finally {
      onPath.delete(value);
    }
  };
  /** Any value outside the two roles: a leaf here is misplaced, a composed `ReadableIds` scope is a node. */
  const visitValue = (value: unknown, at: string): MisplacedFixedReadLeaf | null => {
    if (isFixedReadLeaf(value)) return { at, leaf: value };
    const nested = isComposedReadableIds(value) ? value : scopeOf(value);
    if (nested !== null) return nested.scope === undefined ? null : visitNode(nested.scope, `${at}.scope`);
    if (!isPlainContainer(value)) return null;
    return descend(value, () => {
      const entries: [string, unknown][] = Array.isArray(value)
        ? value.map((item, i) => [`[${i}]`, item])
        : Object.keys(value).map((key) => [`.${key}`, value[key]]);
      for (const [step, item] of entries) {
        const found = visitValue(item, `${at}${step}`);
        if (found) return found;
      }
      return null;
    });
  };
  /** A filter node: `$and` / `$or` list members and `$not`'s operand are nodes, a field's value is an operator map. */
  const visitNode = (node: unknown, at: string): MisplacedFixedReadLeaf | null => {
    if (isFixedReadLeaf(node) || !isPlainContainer(node) || Array.isArray(node)) return visitValue(node, at);
    return descend(node, () => {
      for (const key of Object.keys(node)) {
        const value = node[key];
        const here = `${at}.${key}`;
        let found: MisplacedFixedReadLeaf | null;
        if ((key === '$and' || key === '$or') && Array.isArray(value)) {
          found = null;
          for (let i = 0; i < value.length && found === null; i++) found = visitNode(value[i], `${here}[${i}]`);
        } else if (key === '$not') {
          found = visitNode(value, here);
        } else if (!key.startsWith('$') && !isFixedReadLeaf(value) && isPlainContainer(value) && !Array.isArray(value)) {
          found = visitOperatorMap(value, here);
        } else {
          found = visitValue(value, here);
        }
        if (found) return found;
      }
      return null;
    });
  };
  /** A field's operator map: its `$in` is the one place a leaf compiles. */
  const visitOperatorMap = (map: Record<string, unknown>, at: string): MisplacedFixedReadLeaf | null =>
    descend(map, () => {
      for (const op of Object.keys(map)) {
        const comparand = map[op];
        if (op === '$in' && isFixedReadLeaf(comparand)) continue;
        const found = visitValue(comparand, `${at}.${op}`);
        if (found) return found;
      }
      return null;
    });
  return visitNode(where, path);
}

/**
 * The refusal's message for a leaf {@link findMisplacedFixedReadLeaf} found:
 * where it sits, what it is (by name and table, never its inputs: a recipient
 * is a principal's id, and the message reaches logs), and the one position it
 * compiles in.
 */
export function misplacedFixedReadLeafMessage(found: MisplacedFixedReadLeaf): string {
  return `${describeFixedReadLeaf(found.at, found.leaf)}, where no filter compiler compiles one: a fixed-read leaf `
    + 'compiles only as the $in comparand of a field, the position the engine\'s seam places it in (ADR-0155 D1). '
    + 'The statement was NOT run, rather than read the leaf as an ordinary comparand. Place it as '
    + '{ id: { $in: leaf } }, directly or inside a composed ReadableIds scope.';
}

/** The predicates of a fixed inner read, in the order a compiler emits them. */
export interface FixedInnerReadPredicates {
  /** The one table the read is of. */
  readonly table: string;
  /** The one column it projects, and the column the blank-id guard reads. */
  readonly column: string;
  /** `column = value`, ANDed. */
  readonly equals: readonly (readonly [column: string, value: string])[];
  /** `column IN (values…)`, ANDed; every list is non-empty. */
  readonly memberOf: readonly (readonly [column: string, values: readonly string[]])[];
  /**
   * Whether the blank-id guard carries its `<> ''` half. Always true but where
   * the dialect stores the empty string as NULL, where `IS NOT NULL` is the
   * whole guard.
   */
  readonly notEmpty: boolean;
}

/**
 * [ADR-0155 D2, D4] The predicates of the fixed inner read `leaf` denotes,
 * from its own description (`fixedInnerReadOf`).
 *
 * The description's tenant scope is a literal type: a leaf whose record ever
 * rules a scope other than `'none'` widens it and stops this function from
 * compiling until every compiler answers the new value.
 *
 * @param emptyStringIsNull the dialect stores `''` as NULL (Oracle).
 * @throws TypeError when `leaf` is not a fixed-read leaf (`fixedInnerReadOf`).
 */
export function fixedInnerReadPredicates(
  leaf: FixedReadLeaf,
  { emptyStringIsNull }: { readonly emptyStringIsNull: boolean },
): FixedInnerReadPredicates {
  const read: FixedInnerRead = fixedInnerReadOf(leaf);
  // ADR-0155 ① ruled A: no tenant scope on the inner read. A widened type fails here.
  const tenantScope: 'none' = read.tenantScope;
  void tenantScope;
  return Object.freeze({
    table: read.table,
    column: read.column,
    equals: Object.freeze(Object.entries(read.equals)),
    memberOf: Object.freeze(Object.entries(read.memberOf)),
    notEmpty: !emptyStringIsNull,
  });
}
