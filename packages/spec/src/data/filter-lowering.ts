// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared `FilterCondition → FilterCondition` lowering (ADR-0053 D-D1, as
 * amended 2026-09-30 by the maintainer's ruling on #5930).
 *
 * ## What it is
 *
 * One pure rewrite of a filter tree, applied ONCE at the seams that already run
 * the shared comparand doors (`assertListComparandShapes`,
 * `normalizeFilterComparandTypes`), after those doors AND after filter-token
 * resolution (the amendment's item 3). Every face downstream of a seam — a
 * driver's compiler, an in-process evaluator — receives the lowered filter and
 * compiles what it is handed (item 5). Until a face's deletion card lands it
 * keeps its own copy of the same rules; each copy is idempotent on lowered
 * input (item 9), so a rule is applied at most once in effect.
 *
 * It holds three rules, all of them compositions of leaves every face already
 * compiles (`$and`, `$or`, `$lt`, `$gte`, `$lte`, `$null`):
 *
 * 1. **`$between`** becomes two conjuncts — `$gte` its minimum and `$lte` its
 *    maximum — which rule 2 then reads.
 * 2. **The whole-day upper bound.** A `$lte` whose comparand is a bare
 *    `YYYY-MM-DD` becomes `$lt` {@link nextUtcCalendarDay}(day), in the
 *    calendar-STRING domain: the lowering emits a calendar string, never a
 *    storage form, so `temporalFilterValue` stays operator-blind and each driver
 *    converts the bound as it converts any comparand (ADR-0053 D-A1). Because
 *    the lowering runs before any face converts, D-E3's order — widen the day
 *    first, convert the bound second — holds by construction on every seam-fed
 *    face. On the last supported day ({@link UNBOUNDED_ABOVE}) the upper bound
 *    is dropped: a lone `$lte` keeps only `{ $null: false }`, and a `$between`
 *    keeps its minimum. An instant or a `Date` comparand is never widened, and
 *    `$gte` / `$gt` / `$lt` keep their midnight anchor.
 * 3. **NULL polarity** — the rulings recorded in code by the four hand copies
 *    (`driver-sql`, `driver-turso`'s transport, the analytics read scope and its
 *    `where` normalizer), lowered leaf by leaf exactly as they compile them:
 *    - a negative-polarity leaf (`$ne` a non-null value, `$nin`, `$notContains`)
 *      is satisfied by a row with no value: `{ $or: [{ f: { $null: true } },
 *      { f: { op: v } }] }` (#5298);
 *    - every leaf of a `$not` operand is made TOTAL in the direction its own
 *      operators answer for a missing value (#5146): a leaf no missing value
 *      satisfies takes a `{ f: { $null: false } }` conjunct, a leaf every
 *      missing value satisfies takes the `$or` escape above, and a leaf that is
 *      already total (`$null`, `$exists`, `$empty`, a null `$eq` / `$ne`, a
 *      `{ $field }` comparison) is left alone. A nested `$not` totalises its own
 *      operand.
 *
 * ## Column-type scope (item 7)
 *
 * Rules 1 and 2 are meant for a `datetime` column. A seam that can read the
 * declared field types passes {@link FilterLoweringOptions.isDatetimeColumn};
 * then a `date`, `time` or non-temporal column lowers byte-identical for those
 * two rules — the scope `SqlDriver` holds. A seam that cannot omits it and the
 * rules apply type-blind, as the type-blind emitters do (sound on `Field.date`
 * text, where `< next-day` orders exactly as `<= day`). Rule 3 is not about the
 * column's type and applies on every column.
 *
 * ## Contract
 *
 * - **Copy-on-write.** The input is never mutated; a subtree nothing rewrote is
 *   returned by reference, so a filter with nothing to lower comes back as the
 *   SAME object (the engine seam's allocation contract).
 * - **Idempotent.** `lowerFilterCondition(lowerFilterCondition(x))` deep-equals
 *   `lowerFilterCondition(x)`: rule 2 emits `$lt`, which nothing rewrites
 *   again; rule 1 leaves no `$between`; and rule 3 recognises the two guards it
 *   emits (and the same shapes an author wrote) as already total, so it does
 *   not stack a second guard.
 * - **Never refuses.** It is not a door: a shape it does not understand (a
 *   malformed `$between`, a comparand that is not a bare day, an unknown `$`
 *   key) is passed through exactly as written for the face that owns its
 *   refusal. The doors run before it at every seam.
 * - **Provenance travels.** A rewritten node carries the filter-subtree
 *   provenance mark of the node it replaces ({@link markFilterSubtreeProvenance}),
 *   so a refusal raised downstream resolves to the same author / policy
 *   attribution it resolved to before the rewrite (#8220).
 * - **Closed output vocabulary.** It introduces only `$and`, `$or`, `$lt`,
 *   `$gte`, `$lte` and `$null` — nothing a seam-fed face cannot already compile.
 *
 * A pure function of the filter: no I/O, no state, no dialect. It lives beside
 * {@link nextUtcCalendarDay} and the comparand doors because what a bare day
 * denotes as a bound is protocol (ADR-0053 D-D2), and every seam's package
 * already depends on `@objectstack/spec` — never on the package root entry.
 */

import { isUnboundedAbove, nextUtcCalendarDay } from './calendar-day';
import { filterSubtreeProvenanceOf, markFilterSubtreeProvenance } from './filter-subtree-provenance';

/** How one seam reads the columns it lowers. */
export interface FilterLoweringOptions {
  /**
   * A TYPED seam's declared-type reader: does `column` hold a declared
   * `datetime`? When given, rules 1 and 2 (the `$between` split and the
   * whole-day upper bound) rewrite only the columns it answers `true` for, and
   * every other column lowers byte-identical for those two rules. Omit it only
   * on a seam that cannot read declarations at all; the two rules then apply
   * type-blind (ADR-0053 D-D1, amended, item 7).
   */
  readonly isDatetimeColumn?: (column: string) => boolean;
}

/**
 * Lower one `FilterCondition` (see the module note). A value that is not a
 * filter node — `undefined`, `null`, anything the doors would have refused —
 * is returned as it is.
 */
export function lowerFilterCondition<T>(filter: T, options: FilterLoweringOptions = {}): T {
  return lowerNode(filter, options, false, EMPTY_FIELD_SET) as T;
}

// ── Internals ────────────────────────────────────────────────────────────────

const EMPTY_FIELD_SET: ReadonlySet<string> = new Set();

/**
 * A plain object — the shape every `FilterCondition` node and operator map
 * has. The prototype check is load-bearing, as in the comparand doors: a
 * `Date`, a `Map` or a class instance is data, not structure.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `{ $field: 'other_column' }` — a column reference, never a literal. */
function isFieldReference(value: unknown): boolean {
  return isFilterNode(value) && typeof value.$field === 'string';
}

/** An operator map: a plain object with at least one `$` key. */
function isOperatorMap(spec: unknown): spec is Record<string, unknown> {
  return isFilterNode(spec) && !isFieldReference(spec) && Object.keys(spec).some((k) => k.startsWith('$'));
}

/** Copy the provenance mark of `from` onto `to` (a new object replacing it). */
function carryProvenance<T>(from: unknown, to: T): T {
  const mark = filterSubtreeProvenanceOf(from);
  return mark === null ? to : markFilterSubtreeProvenance(to, mark);
}

/** Is `spec` exactly `{ $null: <flag> }` — the guard conjunct rule 3 emits? */
function isNullFlag(spec: unknown, flag: boolean): boolean {
  return isFilterNode(spec) && Object.keys(spec).length === 1 && spec.$null === flag;
}

/** The field of a single-key node `{ f: spec }` whose key is a column, else `null`. */
function soleField(node: unknown): string | null {
  if (!isFilterNode(node)) return null;
  const keys = Object.keys(node);
  return keys.length === 1 && !keys[0].startsWith('$') ? keys[0] : null;
}

/**
 * Is this `$or` array the NULL escape rule 3 emits — `[{ f: { $null: true } },
 * { f: <spec> }]` — on one column? Its second arm is then already total (TRUE
 * for a row with no value) and is not guarded a second time.
 */
function nullEscapeField(branches: readonly unknown[]): string | null {
  if (branches.length !== 2) return null;
  const field = soleField(branches[0]);
  if (field === null || soleField(branches[1]) !== field) return null;
  return isNullFlag((branches[0] as Record<string, unknown>)[field], true) ? field : null;
}

/**
 * The columns a conjunction already requires to hold a value: a key or an
 * `$and` arm that is exactly `{ f: { $null: false } }`. A leaf beside such a
 * conjunct is FALSE for a row with no value whatever the leaf answers, so a
 * `$not` operand needs no second requirement for that column.
 */
function requiredFields(node: Record<string, unknown>, inherited: ReadonlySet<string>): ReadonlySet<string> {
  let out: Set<string> | undefined;
  const add = (field: string): void => {
    if (inherited.has(field)) return;
    out ??= new Set(inherited);
    out.add(field);
  };
  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith('$') && isNullFlag(value, false)) add(key);
  }
  if (Array.isArray(node.$and)) {
    for (const arm of node.$and) {
      const field = soleField(arm);
      if (field !== null && isNullFlag((arm as Record<string, unknown>)[field], false)) add(field);
    }
  }
  return out ?? inherited;
}

/**
 * Lower one node. `negated` is true inside a `$not` operand (rule 3 makes its
 * leaves total); `required` is the set of columns the enclosing conjunction
 * already requires to hold a value.
 */
function lowerNode(
  node: unknown,
  options: FilterLoweringOptions,
  negated: boolean,
  inheritedRequired: ReadonlySet<string>,
): unknown {
  if (!isFilterNode(node)) return node;
  const required = negated ? requiredFields(node, inheritedRequired) : EMPTY_FIELD_SET;
  let out: Record<string, unknown> | undefined;
  const conjuncts: unknown[] = [];
  const replace = (key: string, value: unknown): void => {
    out ??= { ...node };
    out[key] = value;
  };
  const drop = (key: string): void => {
    out ??= { ...node };
    delete out[key];
  };

  for (const [key, value] of Object.entries(node)) {
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) continue;
      // A NULL escape this lowering (or an author) already wrote: its second
      // arm is total, so it is lowered for rules 1-2 only.
      const escaped = key === '$or' ? nullEscapeField(value) : null;
      let copy: unknown[] | undefined;
      value.forEach((child, index) => {
        const lowered = escaped !== null && index === 1
          ? lowerLeafNode(child as Record<string, unknown>, escaped, options)
          : lowerNode(child, options, negated, key === '$and' ? required : EMPTY_FIELD_SET);
        if (lowered !== child) {
          copy ??= [...value];
          copy[index] = lowered;
        }
      });
      if (copy) replace(key, carryProvenance(value, copy));
      continue;
    }
    if (key === '$not') {
      const lowered = lowerNode(value, options, true, EMPTY_FIELD_SET);
      if (lowered !== value) replace(key, lowered);
      continue;
    }
    // Any other `$` key is not a column: it is passed through as written, for
    // the face that owns its refusal.
    if (key.startsWith('$')) continue;

    const bounded = lowerBounds(key, value, options);
    const guarded = guardNullPolarity(key, bounded.spec, negated, required);
    if (guarded.conjuncts.length === 0 && bounded.conjuncts.length === 0 && guarded.spec === value) continue;
    if (guarded.spec === undefined) drop(key);
    else replace(key, guarded.spec);
    conjuncts.push(...bounded.conjuncts.flatMap((spec) => guardNullPolarity(key, spec, negated, required).all), ...guarded.conjuncts);
  }

  if (conjuncts.length > 0) {
    const existing = out?.$and ?? node.$and;
    replace('$and', Array.isArray(existing) ? [...existing, ...conjuncts] : conjuncts);
  }
  return out ? carryProvenance(node, out) : node;
}

/**
 * The second arm of a NULL escape, `{ f: <spec> }`: rules 1-2 only (its NULL
 * polarity is already the escape's).
 */
function lowerLeafNode(
  node: Record<string, unknown>,
  field: string,
  options: FilterLoweringOptions,
): unknown {
  const spec = node[field];
  const bounded = lowerBounds(field, spec, options);
  if (bounded.spec === spec && bounded.conjuncts.length === 0) return node;
  const out: Record<string, unknown> = {};
  if (bounded.spec !== undefined) out[field] = bounded.spec;
  if (bounded.conjuncts.length > 0) out.$and = bounded.conjuncts.map((c) => ({ [field]: c }));
  return carryProvenance(node, out);
}

/**
 * Rules 1 and 2 on one column's spec. Returns the rewritten spec (the SAME
 * reference when nothing applied; `undefined` never — a spec always keeps at
 * least one operator) and any operator that could not join the map because an
 * operator of that name is already in it (the one-operator-per-conjunct rule:
 * a lowered key never clobbers an author's own).
 */
function lowerBounds(
  field: string,
  spec: unknown,
  options: FilterLoweringOptions,
): { spec: unknown; conjuncts: Record<string, unknown>[] } {
  const none = { spec, conjuncts: [] as Record<string, unknown>[] };
  if (!isOperatorMap(spec)) return none;
  if (!('$lte' in spec) && !('$between' in spec)) return none;
  if (options.isDatetimeColumn && !options.isDatetimeColumn(field)) return none;

  const emitted: [string, unknown][] = [];
  let changed = false;
  for (const [op, comparand] of Object.entries(spec)) {
    if (op === '$lte') {
      const upper = upperBound(comparand);
      if (upper !== null) changed = true;
      emitted.push(...(upper ?? [['$lte', comparand] as [string, unknown]]));
      continue;
    }
    if (op === '$between' && isLiteralRange(comparand)) {
      changed = true;
      emitted.push(['$gte', comparand[0]]);
      // On the last supported day the range keeps its minimum alone: `$gte`
      // already asks for a value, so no `$null: false` is added beside it.
      const upper = upperBound(comparand[1]);
      if (upper === null) emitted.push(['$lte', comparand[1]]);
      else if (upper[0][0] === '$lt') emitted.push(...upper);
      continue;
    }
    emitted.push([op, comparand]);
  }
  if (!changed) return none;

  const map: Record<string, unknown> = {};
  const conjuncts: Record<string, unknown>[] = [];
  for (const [op, comparand] of emitted) {
    if (Object.prototype.hasOwnProperty.call(map, op)) conjuncts.push({ [op]: comparand });
    else map[op] = comparand;
  }
  return { spec: carryProvenance(spec, map), conjuncts };
}

/**
 * Rule 2 on one upper bound: `[['$lt', nextDay]]` for a bare day,
 * `[['$null', false]]` on the last supported day, `null` when the bound is not
 * a bare calendar day (an instant, a `Date`, a `{ $field }`, anything else)
 * and is kept as written.
 */
function upperBound(comparand: unknown): [string, unknown][] | null {
  const next = nextUtcCalendarDay(comparand);
  if (next === null) return null;
  return isUnboundedAbove(next) ? [['$null', false]] : [['$lt', next]];
}

/**
 * A `$between` rule 1 splits: exactly two LITERAL endpoints. A range holding a
 * `{ $field }` reference or other structure is left whole, so the face that
 * refuses it still refuses it — splitting it would hand `$gte` a column
 * reference, which is a comparison some faces accept.
 */
function isLiteralRange(comparand: unknown): comparand is [unknown, unknown] {
  return Array.isArray(comparand)
    && comparand.length === 2
    && comparand.every((end) => end === null || typeof end !== 'object' || end instanceof Date);
}

// ── Rule 3: NULL polarity ────────────────────────────────────────────────────

/** How one column constraint is made total for a row with no value. */
type NullGuard = 'none' | 'requireValue' | 'allowNull';

/**
 * Does a row with no value satisfy this one operator, in the two-valued
 * reading the JS faces give it? The table of the four hand copies
 * (`driver-sql`'s `nullValueSatisfiesOperator`), cell for cell.
 */
function nullValueSatisfiesOperator(op: string, value: unknown): boolean {
  switch (op) {
    case '$eq': return value === null;
    case '$ne': return value !== null;
    case '$null': return value === true;
    case '$exists': return value === false;
    case '$empty': return value === true;
    case '$nin': return true;
    case '$notContains': return true;
    default: return false;
  }
}

/** The six scalar comparisons a `{ $field }` comparand compiles as a column-to-column test. */
const CROSS_FIELD_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
]);

/**
 * Is this operator already TOTAL for a row with no value — TRUE or FALSE, never
 * UNKNOWN? The copies' `operatorIsNullTotal`, cell for cell.
 */
function operatorIsNullTotal(op: string, value: unknown): boolean {
  if (CROSS_FIELD_COMPARISON_OPERATORS.has(op) && isFieldReference(value)) return true;
  switch (op) {
    case '$null':
    case '$exists':
    case '$empty':
      return true;
    case '$eq':
    case '$ne':
      return value === null;
    default:
      return false;
  }
}

/**
 * The guard one column constraint needs inside a `$not` operand: total when
 * every operator is, satisfied by no value only when every operator is. The
 * copies' `nullGuardForFieldSpec`, cell for cell.
 */
function nullGuardForFieldSpec(spec: unknown): NullGuard {
  if (spec === null) return 'none';
  if (!isFilterNode(spec)) return 'requireValue';
  let total = true;
  let nullSatisfies = true;
  for (const [op, value] of Object.entries(spec)) {
    if (!operatorIsNullTotal(op, value)) total = false;
    if (!nullValueSatisfiesOperator(op, value)) nullSatisfies = false;
  }
  if (total) return 'none';
  return nullSatisfies ? 'allowNull' : 'requireValue';
}

/**
 * A negative-polarity operator a row with no value satisfies OUTSIDE a `$not`
 * (#5298): `$ne` a value, `$nin`, `$notContains`. A `$ne: null` is the total
 * `IS NOT NULL`, and a `$ne: { $field }` is the total column comparison.
 */
function isNegativePolarityOperator(op: string, value: unknown): boolean {
  if (op === '$ne') return value !== null && !isFieldReference(value);
  return op === '$nin' || op === '$notContains';
}

/** `{ $or: [{ f: { $null: true } }, { f: spec }] }` — TRUE for a row with no value. */
function nullEscape(field: string, spec: unknown): Record<string, unknown> {
  return { $or: [{ [field]: { $null: true } }, { [field]: spec }] };
}

/**
 * Rule 3 on one column's spec. Returns the spec that stays under the column's
 * key (`undefined` when the whole spec moved into a guard) and the conjuncts
 * the guard adds to the enclosing node's `$and`. `all` is the spec and the
 * conjuncts as one list of conjuncts, for a spec that is itself a conjunct.
 */
function guardNullPolarity(
  field: string,
  spec: unknown,
  negated: boolean,
  required: ReadonlySet<string>,
): { spec: unknown; conjuncts: unknown[]; all: unknown[] } {
  if (negated) {
    const guard = nullGuardForFieldSpec(spec);
    if (guard === 'none' || (guard === 'requireValue' && required.has(field))) {
      return { spec, conjuncts: [], all: [{ [field]: spec }] };
    }
    const conjuncts = guard === 'requireValue'
      ? [{ [field]: { $null: false } }, { [field]: spec }]
      : [nullEscape(field, spec)];
    return { spec: undefined, conjuncts, all: conjuncts };
  }
  if (!isOperatorMap(spec)) return { spec, conjuncts: [], all: [{ [field]: spec }] };
  const kept: Record<string, unknown> = {};
  const conjuncts: unknown[] = [];
  for (const [op, value] of Object.entries(spec)) {
    if (isNegativePolarityOperator(op, value)) conjuncts.push(nullEscape(field, { [op]: value }));
    else kept[op] = value;
  }
  if (conjuncts.length === 0) return { spec, conjuncts: [], all: [{ [field]: spec }] };
  const rest = Object.keys(kept).length > 0 ? carryProvenance(spec, kept) : undefined;
  return {
    spec: rest,
    conjuncts,
    all: rest === undefined ? conjuncts : [{ [field]: rest }, ...conjuncts],
  };
}
