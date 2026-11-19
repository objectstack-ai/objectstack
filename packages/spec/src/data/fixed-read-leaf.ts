// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4] The pieces two engine-internal leaves share, built once in the
 * two-leaf shape: ADR-0155's `SharedRecordIds` (`./shared-record-ids.ts`) and
 * ADR-0147's leaf over `sys_member`, which is not built yet and adds its row
 * here when its spec card lands. ⛔ Neither record builds a private copy of
 * anything below (ADR-0155 D4, "Sequencing").
 *
 * Both leaves are a *fixed-read leaf*: a branded `$in` comparand that arrives
 * composed and compiles to a FIXED INNER READ — one platform table, one
 * projected column, a closed set of bound equality and membership predicates,
 * behind a blank-id guard, under system authority, with the tenant scope its
 * record rules (none for either: ADR-0147 D-b, ADR-0155 ① ruled A). That is one
 * mechanism, and this module declares its two shared halves:
 *
 *  - **The description** ({@link FixedInnerRead}). Each leaf supplies its own
 *    ({@link fixedInnerReadOf}), and each evaluator (`driver-sql`, the Turso
 *    remote transport, `driver-memory`, the analytics native compiler) builds
 *    its compile of the description once. ⛔ No evaluator restates either
 *    leaf's predicate by hand.
 *  - **The brand dispatch** ({@link fixedReadLeafBrandOf},
 *    {@link isFixedReadLeaf}). The comparand-shape door admits these leaves
 *    through ONE option that names the brands it admits,
 *    `admitFixedReadLeaves` (`./filter-comparand-shape.ts`), not one flag per
 *    brand; this dispatch is what that option reads.
 *
 * What is per leaf and never shared: the brand, its factory and guard, its
 * meaning and its producer; what it compiles to OUTSIDE its subquery (ADR-0147
 * ORs a caller arm in; `SharedRecordIds` is the subquery alone); and what an
 * evaluator that cannot run it answers. The executor seam that passes these
 * leaves through (position, verb, recipient, descent into composed scopes, the
 * two classes it recognises) is the engine's, built once in
 * `@objectstack/objectql` (ADR-0155 plan step 2).
 *
 * ## What every evaluator owes the description
 *
 * `column IN (SELECT column FROM table WHERE <each equals> AND <each memberOf>
 * AND column IS NOT NULL AND column <> '')`, or the in-process equivalent, in
 * the position the leaf holds:
 *
 *  - **The blank-id guard is the mechanism's, on every leaf**, so it is not a
 *    field: a NULL in the subquery would make a negation (`id NOT IN (…)`)
 *    answer no row at all, and an empty id names no record.
 *  - **System authority.** No row-level security, sharing or field-level
 *    security applies to the inner table. The read is never routed through the
 *    engine's own read path, so no middleware and no find hook runs on it.
 *  - **The tenant scope is {@link FixedInnerRead.tenantScope}**, which is
 *    `'none'` for every leaf declared today: ⛔ the evaluator does not apply its
 *    own tenant scope to the inner read. The OUTER statement's tenant wall is
 *    untouched.
 *  - **Set semantics.** Several matching rows on one id are one member. ⛔ No
 *    `EXISTS`, no correlated form, no join.
 *  - **Same datasource.** The inner table is read on the datasource the outer
 *    object is bound to; an object bound to another one is the engine seam's to
 *    recognise before any driver is called.
 *
 * Every value here is frozen, and {@link fixedInnerReadOf} answers a fresh one
 * per call.
 */

import { SHARED_RECORD_IDS_BRAND, SharedRecordIds, isSharedRecordIds } from './shared-record-ids';

/**
 * [ADR-0155 D4] The fixed inner read a fixed-read leaf denotes: the set of
 * {@link column} values over the rows of {@link table} that every
 * {@link equals} and every {@link memberOf} predicate admits, with the blank-id
 * guard, under system authority.
 */
export interface FixedInnerRead {
  /** The one platform table the read is of. */
  readonly table: string;
  /** The one column it projects; the leaf's members are its values. */
  readonly column: string;
  /** Bound equality predicates, ANDed: column → the value it must equal. */
  readonly equals: Readonly<Record<string, string>>;
  /** Bound membership predicates, ANDed: column → the non-empty list of values it must be one of. */
  readonly memberOf: Readonly<Record<string, readonly string[]>>;
  /**
   * The tenant scope the leaf's record rules for the inner read. `'none'`: the
   * evaluator applies no tenant scope to it (ADR-0155 ① ruled A; ADR-0147 D-b).
   * A literal, so a leaf whose record ever rules otherwise widens this type and
   * every evaluator has to answer the new value.
   */
  readonly tenantScope: 'none';
}

/** The brand of every fixed-read leaf declared in this package. ADR-0147's leaf adds its own. */
export type FixedReadLeafBrand = typeof SHARED_RECORD_IDS_BRAND;

/** Every fixed-read leaf declared in this package. ADR-0147's leaf adds its own. */
export type FixedReadLeaf = SharedRecordIds;

/**
 * One row per fixed-read leaf: its brand, its guard and its description.
 *
 * Each guard refuses a value that carries any symbol-keyed property besides its
 * own brand, so the guards are disjoint and at most one row answers for any
 * value. Not exported: a caller names the brands it admits; ⛔ nothing offers
 * "every brand" as one value.
 */
const FIXED_READ_LEAVES: readonly {
  readonly brand: FixedReadLeafBrand;
  readonly is: (value: unknown) => boolean;
  readonly innerRead: (leaf: FixedReadLeaf) => FixedInnerRead;
}[] = Object.freeze([
  Object.freeze({ brand: SHARED_RECORD_IDS_BRAND, is: isSharedRecordIds, innerRead: SharedRecordIds.innerRead }),
]);

/**
 * The brand of the fixed-read leaf `value` is, or `undefined` when it is none:
 * an unbranded copy, a `ReadableIds` leaf, a list, `null` and every primitive.
 */
export function fixedReadLeafBrandOf(value: unknown): FixedReadLeafBrand | undefined {
  return FIXED_READ_LEAVES.find((row) => row.is(value))?.brand;
}

/**
 * Is `value` a fixed-read leaf — and, when `brands` is given, one of those
 * brands? An evaluator asks it without `brands` to recognise every leaf it owes
 * an answer for; the comparand-shape door asks it with the brands its caller
 * names.
 */
export function isFixedReadLeaf(value: unknown, brands?: readonly FixedReadLeafBrand[]): value is FixedReadLeaf {
  const brand = fixedReadLeafBrandOf(value);
  return brand !== undefined && (brands === undefined || brands.includes(brand));
}

/**
 * The fixed inner read `leaf` denotes, from the leaf's own description
 * (`SharedRecordIds.innerRead` for that brand).
 *
 * @throws TypeError when `leaf` is not a fixed-read leaf: ⛔ an evaluator never
 *         reads one as an ordinary comparand, and never reads a non-leaf as one.
 */
export function fixedInnerReadOf(leaf: FixedReadLeaf): FixedInnerRead {
  const row = FIXED_READ_LEAVES.find((candidate) => candidate.is(leaf));
  if (row === undefined) {
    throw new TypeError(
      'fixedInnerReadOf() needs a branded fixed-read leaf (SharedRecordIds), received ' +
        `${leaf === null ? 'null' : Array.isArray(leaf) ? 'an array' : typeof leaf}` +
        `${leaf !== null && typeof leaf === 'object' && !Array.isArray(leaf) ? ' without a fixed-read leaf brand' : ''}.`,
    );
  }
  return row.innerRead(leaf);
}
