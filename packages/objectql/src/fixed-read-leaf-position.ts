// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D1, D4] Where a FIXED-READ LEAF may sit, and on which verb: the
 * half of the engine's executor seam for these leaves that needs nothing but
 * the filter. The other half, the recipient, the two classes and the driver's
 * declaration, is `fixed-read-leaf-seam.ts`, which asks this walk first; the
 * module note there carries the whole seam.
 *
 * A module of its own because the comparand door
 * (`filter-comparand-shape.ts#assertListComparandShapes`) asks it too, before
 * the middleware chain, and the door sits below `engine-top-level.ts`, which
 * the other half reads: one walk, at the door and at the boundary, with no
 * import cycle.
 *
 * - **Position (D1).** Legal only as the `$in` comparand of `id` on the
 *   object it names: directly in that object's `where`, or inside the
 *   composed scope of a `ReadableIds` leaf whose parent is that object (the
 *   walk descends into every composed scope). It composes under `$and`, `$or`
 *   and `$not`. Every other position is refused: another field or object, an
 *   implicit-equality value, a `$eq` / `$nin` comparand, a list member, a node
 *   of its own, a nested-relation condition, a `having`, an aggregation's
 *   filter.
 * - **Verb (D1, ③ ruled A).** The read form on `find`, `findOne`, `count` and
 *   `aggregate`, and inside every composed scope (the `where` of a read of its
 *   parent). The write form only in the `where` of a predicate `update`, where
 *   the read form is refused. `delete` admits neither.
 *
 * Every refusal is ADR-0139 D3's envelope, `INTERNAL_ERROR` / 500, ⛔ never
 * `INVALID_FILTER`: no request can spell the leaf, so the fault is the
 * in-process code that wrote it. `index.ts` re-exports nothing from this
 * module.
 */

import {
  SHARED_RECORD_IDS_BRAND,
  fixedReadLeafNameOf,
  isComposedReadableIds,
  isFixedReadLeaf,
  type FixedReadLeaf,
  type FixedReadLeafBrand,
  type FixedReadLeafName,
} from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { describeFixedReadLeaf, fixedReadLeafRefusal, type FixedReadLeafRefusalError } from '@objectstack/core';

/**
 * [ADR-0155 D4] The brands the engine's comparand door admits as a `$in`
 * comparand (`admitFixedReadLeaves`): ONE list that names its brands, never a
 * flag per brand. ADR-0147's leaf joins it on the card that adds that leaf to
 * the seam, with its row in {@link LEAF_RULES}.
 */
export const ENGINE_FIXED_READ_LEAF_BRANDS: readonly FixedReadLeafBrand[] = Object.freeze([SHARED_RECORD_IDS_BRAND]);

/** The evaluator the seam names in its own refusals. */
export const FIXED_READ_LEAF_SEAM = 'objectql';

/** The verbs whose `where` may carry the read form. */
const READ_VERBS: ReadonlySet<string> = new Set(['find', 'findOne', 'count', 'aggregate']);

/**
 * What the seam reads per leaf, one row per leaf name: the meaning of each is
 * the leaf's own (ADR-0155 D4: per leaf, never shared), and the seam applies
 * one rule over all of them.
 */
export interface FixedReadLeafRules {
  /** The field and object the leaf's `$in` must sit on. */
  readonly position: (leaf: FixedReadLeaf) => { readonly field: string; readonly object: string };
  /** `write` for the form a predicate update carries, `read` for every other. */
  readonly form: (leaf: FixedReadLeaf) => 'read' | 'write';
  /** Does the context the operation runs under admit every identity the leaf names (a system context aside)? */
  readonly principalAdmitted: (leaf: FixedReadLeaf, context: ExecutionContext | undefined) => boolean;
}

const LEAF_RULES: Readonly<Record<FixedReadLeafName, FixedReadLeafRules>> = Object.freeze({
  SharedRecordIds: Object.freeze({
    position: (leaf: FixedReadLeaf) => ({ field: 'id', object: leaf.object }),
    form: (leaf: FixedReadLeaf) => (leaf.accessLevels === undefined ? 'read' : 'write'),
    // Its one identity, the recipient: the context's user, or its delegator.
    principalAdmitted: (leaf: FixedReadLeaf, context: ExecutionContext | undefined) =>
      leaf.recipient === context?.userId || leaf.recipient === context?.onBehalfOf?.userId,
  }),
});

/** The rules of the leaf `leaf` is. */
export function fixedReadLeafRulesOf(leaf: FixedReadLeaf): FixedReadLeafRules {
  // `isFixedReadLeaf` vouched for the brand, so the name is one of the table's keys.
  return LEAF_RULES[fixedReadLeafNameOf(leaf) as FixedReadLeafName];
}

/** One fixed-read leaf the seam may hand to a driver: the comparand of the `$in` at `at`. */
export interface FixedReadLeafSite {
  readonly leaf: FixedReadLeaf;
  readonly at: string;
}

const NO_SITES: readonly FixedReadLeafSite[] = Object.freeze([]);

/** Every refusal the seam built, so the boundary logs the seam's refusals and nothing else. */
const SEAM_REFUSALS = new WeakSet<Error>();

/** Did the seam build `err` ({@link fixedReadLeafSeamRefusal})? */
export function isFixedReadLeafSeamRefusal(err: unknown): boolean {
  return err instanceof Error && SEAM_REFUSALS.has(err);
}

/**
 * The seam's refusal of the leaf at `at` in an operation on `object`: the
 * composition-fault envelope (`@objectstack/core`'s `fixedReadLeafRefusal`),
 * naming the seam, the operation, the leaf, `why` and the remedy.
 */
export function fixedReadLeafSeamRefusal(object: string, operation: string, at: string, leaf: FixedReadLeaf, why: string): FixedReadLeafRefusalError {
  const err = fixedReadLeafRefusal(
    FIXED_READ_LEAF_SEAM,
    `${operation}('${object}'): ${describeFixedReadLeaf(at, leaf)}, and ${why} The operation was NOT run and no driver was asked.`,
    object,
  );
  SEAM_REFUSALS.add(err);
  return err;
}

/** A plain filter object or a list: what the walk descends into. A `Date` or class instance holds no filter. */
function isWalkable(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * [ADR-0155 D1] Every fixed-read leaf in `node` the seam may hand to a
 * driver, in walk order, and a loud refusal (`INTERNAL_ERROR` / 500) for the
 * first leaf out of position or on the wrong verb. `path` is the clause
 * (`where`, `having`, `aggregations[i].filter`); `at` labels the root and
 * defaults to it. Read-only and cycle-safe; a filter with no leaf answers a
 * shared empty list.
 *
 * It judges the leaf's position, its verb and its form only: the recipient,
 * the classes and the declaration are `fixed-read-leaf-seam.ts`'s
 * `passFixedReadLeaves`, which asks this walk first.
 */
export function collectFixedReadLeaves(
  object: string,
  operation: string,
  node: unknown,
  path = 'where',
  at: string = path,
): readonly FixedReadLeafSite[] {
  let sites: FixedReadLeafSite[] | undefined;
  const onPath = new Set<object>();

  const misplaced = (leaf: FixedReadLeaf, here: string): Error => {
    const { field, object: named } = fixedReadLeafRulesOf(leaf).position(leaf);
    return fixedReadLeafSeamRefusal(object, operation, here, leaf, path === 'where'
      ? `the leaf is legal only as the $in comparand of ${field} on '${named}', the object it names, in that `
        + `object's where or inside the composed scope of a ReadableIds leaf over it, under $and, $or and $not; `
        + `its producer wrote it elsewhere. Write it there as { ${field}: { $in: leaf } }.`
      : `the leaf is legal only in the where of a read, never in ${path}: `
        + `${path === 'having' ? 'having filters the aggregated rows' : "an aggregation's filter is evaluated in memory"}. `
        + 'Narrow the rows in where instead.');
  };

  // Any leaf anywhere inside `value` is out of position.
  const scan = (value: unknown, here: string): void => {
    if (isFixedReadLeaf(value)) throw misplaced(value, here);
    if (isComposedReadableIds(value)) return scan(value.scope, `${here}.scope`);
    if (!isWalkable(value) || onPath.has(value)) return;
    onPath.add(value);
    try {
      if (Array.isArray(value)) value.forEach((item, i) => scan(item, `${here}[${i}]`));
      else for (const key of Object.keys(value)) scan((value as Record<string, unknown>)[key], `${here}.${key}`);
    } finally {
      onPath.delete(value);
    }
  };

  const judge = (leaf: FixedReadLeaf, field: string, scopeObject: string, nested: boolean, here: string): void => {
    if (path !== 'where') throw misplaced(leaf, here);
    if (!READ_VERBS.has(operation) && operation !== 'update') {
      throw fixedReadLeafSeamRefusal(object, operation, here, leaf,
        `no fixed-read leaf is admitted on ${operation}: a read's where carries the read form and a predicate update's `
        + `where the write form, and ${operation} is neither. Write the predicate without the leaf.`);
    }
    const position = fixedReadLeafRulesOf(leaf).position(leaf);
    if (field !== position.field || scopeObject !== position.object) throw misplaced(leaf, here);
    const wanted = nested || READ_VERBS.has(operation) ? 'read' : 'write';
    const form = fixedReadLeafRulesOf(leaf).form(leaf);
    if (form !== wanted) {
      throw fixedReadLeafSeamRefusal(object, operation, here, leaf,
        `it is the ${form} form, where ${nested ? 'a composed scope, the where of a read of its parent,' : `the where of ${operation}`} `
        + `admits only the ${wanted} form: the write form belongs in a predicate update's where alone, the read form `
        + 'everywhere else a leaf may sit. Build the form for this verb.');
    }
    (sites ??= []).push({ leaf, at: here });
  };

  // A filter node: logical operators over field conditions.
  const visitNode = (value: unknown, scopeObject: string, nested: boolean, here: string): void => {
    if (isFixedReadLeaf(value)) throw misplaced(value, here);
    if (!isWalkable(value) || Array.isArray(value)) return scan(value, here);
    if (onPath.has(value)) return;
    onPath.add(value);
    try {
      for (const key of Object.keys(value)) {
        const child = (value as Record<string, unknown>)[key];
        const there = `${here}.${key}`;
        if ((key === '$and' || key === '$or') && Array.isArray(child)) {
          child.forEach((item, i) => visitNode(item, scopeObject, nested, `${there}[${i}]`));
        } else if (key === '$not') {
          visitNode(child, scopeObject, nested, there);
        } else if (key.startsWith('$')) {
          scan(child, there);
        } else {
          visitField(key, child, scopeObject, nested, there);
        }
      }
    } finally {
      onPath.delete(value);
    }
  };

  // One field's condition: a `$in` holding a leaf or a composed scope, or anything else.
  const visitField = (field: string, value: unknown, scopeObject: string, nested: boolean, here: string): void => {
    if (isFixedReadLeaf(value)) throw misplaced(value, here);
    if (!isWalkable(value) || Array.isArray(value) || isComposedReadableIds(value)) return scan(value, here);
    for (const op of Object.keys(value)) {
      const comparand = (value as Record<string, unknown>)[op];
      const there = `${here}.${op}`;
      if (op === '$in' && isFixedReadLeaf(comparand)) judge(comparand, field, scopeObject, nested, there);
      else if (op === '$in' && isComposedReadableIds(comparand)) {
        visitNode(comparand.scope, comparand.object, true, `${there}.scope`);
      } else scan(comparand, there);
    }
  };

  visitNode(node, object, false, at);
  return sites ?? NO_SITES;
}
