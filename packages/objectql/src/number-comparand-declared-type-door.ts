// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20351] The NUMBER-comparand declared-type door, at the engine's single
 * filter collection point: the fifth gate on the seam that already carries
 * the #5869 comparand-shape gate, the #8296 unmaterializable-field gate, the
 * #15661 text-operator declared-type gate and the #8690 temporal-comparand
 * gate. It answers a fifth question about the same predicate: *is this string
 * a number the column can be compared with.*
 *
 * ## The direction this implements (triage, recorded on #20336)
 *
 * > **Direction, decided here:** the door refuses a non-numeric string against
 * > a number field with `INVALID_FILTER` / 400, naming the field, on every
 * > driver and position, before any bind. That is the loud answer the charter
 * > prefers, and the one the temporal door already gives. ⛔ Not a driver-side
 * > catch that turns PostgreSQL's 500 into a 200.
 *
 * Routed on #15661's two-lane precedent. Lane (1), the CONTRACT, is
 * `@objectstack/spec/data`'s `filter-number-comparand-declared-type.ts`
 * (#20336): the platform's one numeric grammar, the pure verdict
 * ({@link numberComparandDoorVerdict}), the refusal words
 * ({@link numberComparandRefusalMessage}), the fixture and the case table.
 * This file is lane (2), the door that consults it. ⛔ Nothing here reads a
 * string as a number: the verdict does, so a form the grammar admits or
 * refuses tomorrow is admitted or refused here with no change in this package.
 *
 * ## What ran before this door, measured on `origin/main` 3062e5001
 *
 * `where { amount: { $gt: "abc" } }` over a declared `number` field, three rows
 * (5, 12, 30), through `engine.find` / `engine.aggregate` and
 * `POST /api/v1/data/:object/query`:
 *
 * | position | InMemoryDriver | SqlDriver, SQLite | SqlDriver, PostgreSQL 16 |
 * |:--|:--|:--|:--|
 * | `where`: `$gt` / `$eq` / implicit / `$in` member `"abc"` | 200, no rows | 200, no rows | 500 `DATABASE_ERROR` |
 * | `where`: `$eq ""`, and `$gt "{current_user_id}"` over REST | 200, no rows | 200, no rows | 500 `DATABASE_ERROR` |
 * | `where`: `$gt "12"` / `$eq "12"` (a numeric string) | 200, **no rows** | 200, 1 row | 200, 1 row |
 * | per-aggregation `filter`: `$gt "abc"` | 200, count 0 | 200, count 0 | 200, count 0 |
 * | `having` on `sum(amount)`: `$gt "abc"` | 200, no group | 200, no group | 200, no group |
 *
 * One client mistake, three answers, one of them a server fault; and a numeric
 * string read two ways (the memory matcher compares `12 > "12"` without
 * coercing it, the SQL backends bind it with numeric affinity or input).
 *
 * ## The door's two answers
 *
 * - **Refuse** a string the grammar does not read as a number: `INVALID_FILTER`
 *   / 400, the existing filter envelope, in the contract's words, before any
 *   driver is resolved. A `{placeholder}` is refused too, unresolved: every
 *   filter token resolves to an id or a date, never a number (the contract
 *   argues it), and this door runs before `resolveWhereTokens`, as its
 *   temporal neighbour records it must.
 * - **Narrow** a string the grammar does read as a number to that number,
 *   copy-on-write, so every backend receives the one value the string names:
 *   the caller's filter is never edited, and a filter with nothing to narrow
 *   is returned by reference (the common path allocates nothing).
 *
 * ## Where it sits in the ladder, and why exactly there
 *
 * After the temporal door and before the comparand-TYPE door
 * (`normalizeFilterComparandTypes`) on `where`'s object form, and after the
 * temporal door on the lowered array form, so the order of the field-aware
 * doors is the same on both spellings:
 *
 * 1. `assertListComparandShapes` — can this comparand run at all (#5869).
 * 2. `assertFilterIsMaterializable` — is there a column (#8296).
 * 3. `assertTextOperatorTargetsAreStringCapable` — can the column ever hold a
 *    string (#15661). A text operator over a number field is refused there,
 *    and its comparand is a substring, never a number: this door does not
 *    judge the text operators.
 * 4. `assertTemporalComparandsInterpretable` — can the column's storage rule
 *    read the value (#8690). The two doors judge disjoint field classes.
 * 5. **this door** — is the string a number (#20351).
 *
 * `formula` is judged one door EARLIER and never reaches this one:
 * `assertFilterIsMaterializable` refuses every filter over a formula field with
 * `INVALID_FIELD` / 400. The verdict is still handed a formula's `returnType`,
 * so the day that class becomes filterable this door already answers it.
 *
 * ## The positions, and the one that is not this seam's
 *
 * - **`where`**, both spellings — the object form every protocol door hands
 *   over, and the `FilterArray` sugar after `parseFilterAST` lowers it — on
 *   every verb that calls `lowerWhereFilterArray` (`find` / `findOne` /
 *   `count` / `aggregate` / `update` / `delete`), and on the judge-only
 *   `judgeFilter` (`judgeWhereAdmission` calls the same function).
 * - **The per-aggregation `filter`** ({@link narrowNumberComparands} with its
 *   path rooted at `aggregations[i].filter`), against the object's declared
 *   fields, since that filter narrows the object's raw rows.
 * - **`having`** ({@link narrowHavingNumberComparands}). The engine evaluates
 *   it over the aggregated rows, so the column is the aggregated one: judged
 *   when #20127's `aggregatedRowColumnClasses` classes it `numeric` (a `count`
 *   / `sum` / `avg`, and a groupBy or `min` / `max` of a numeric field). Such
 *   a column has no declared `FieldType` of its own; the verdict is handed
 *   `number`, the member of the numeric class it holds.
 * - **Not here: RLS / sharing / tenant predicates.** Like every door on this
 *   seam it runs on the CALLER's filter, before the middleware chain composes
 *   those predicates onto the AST: an injected read filter is the platform's
 *   own, not a declaration the caller can fix. A policy predicate reaches this
 *   door at AUTHORING instead, where `validateRlsPredicateEnforceability` asks
 *   the engine's `judgeFilter` — which runs this door — when the host hands
 *   it a judge.
 *
 * ## Scope — the same boundaries as the neighbours
 *
 * - **UNDOTTED keys naming a declared field.** A dotted key is
 *   `filter-dotted-head`'s subject, and an undeclared key keeps the engine's
 *   registry-less tolerance (#7534): no second opinion about a name.
 * - **A registry-less host gets no verdict** — a door that cannot see the field
 *   map invents none.
 * - **Only the value comparisons**: the implicit comparand, the scalar
 *   operators and every member of the list operators the contract names. The
 *   flags (`$null` / `$exists` / `$empty`), the text operators and a
 *   `{ $field }` reference are not a value of the field and are left alone.
 *
 * @see numberComparandDoorVerdict — the pure verdict (lane 1, `@objectstack/spec`).
 * @see https://github.com/objectstack-ai/objectstack/issues/20336 (the contract)
 * @see https://github.com/objectstack-ai/objectstack/issues/20351 (this door)
 */

import {
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
  numberComparandDoorVerdict,
  numberComparandFieldVerdict,
  numberComparandRefusalMessage,
  type NumberComparandDoorFieldMeta,
  type NumberComparandRefusalSite,
} from '@objectstack/spec/data';
import { invalidFilterError } from './filter-comparand-shape.js';
import type { AggregatedColumnClass } from './having-filter.js';

/** The operators whose one comparand is judged — the contract's list, never a re-listing. */
const SCALAR_OPERATORS: ReadonlySet<string> = new Set(NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS);

/** The operators each of whose MEMBERS is judged as a comparand in its own right. */
const LIST_OPERATORS: ReadonlySet<string> = new Set(NUMBER_COMPARAND_DOOR_LIST_OPERATORS);

/** A comparand the door refuses: the site the contract's words are written from. */
export type NonNumericComparand = NumberComparandRefusalSite;

/** What one filter position supplies to the walk: the field meta a KEY names, or `null`. */
type MetaOf = (key: string) => NumberComparandDoorFieldMeta | null;

/** The walk's answer: the (possibly narrowed) node, or the first refusal. */
type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refusal: NonNumericComparand };

const kept = (value: unknown): Outcome => ({ ok: true, value });

/**
 * A plain object — filter STRUCTURE rather than a comparand. The same
 * classification the sibling gates make: a `Date` is a comparand even though
 * `typeof` calls it an object.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/** A `{ $field: 'other_column' }` reference is not a literal — never judged. */
function isFieldReference(value: unknown): boolean {
  return isFilterNode(value) && typeof (value as { $field?: unknown }).$field === 'string';
}

/** The slice of a field declaration the verdict reads. */
function fieldMetaOf(def: unknown): NumberComparandDoorFieldMeta | null {
  if (!isFilterNode(def)) return null;
  const type = (def as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  const returnType = (def as { returnType?: unknown }).returnType;
  return typeof returnType === 'string' ? { type, returnType } : { type };
}

/** One comparand at a judged position: the spec's verdict, routed. */
function judgeComparand(
  meta: NumberComparandDoorFieldMeta,
  field: string,
  comparand: unknown,
  path: string,
): Outcome {
  const verdict = numberComparandDoorVerdict(meta, comparand);
  if (verdict.verdict === 'narrows') return kept(verdict.value);
  if (verdict.verdict !== 'door-refusal') return kept(comparand);
  return {
    ok: false,
    refusal: {
      field,
      declaredType: meta.type,
      ...(meta.returnType === undefined ? {} : { returnType: meta.returnType }),
      path,
      // `door-refusal` is answered for a string comparand only.
      value: comparand as string,
      form: verdict.form,
    },
  };
}

/** One judged field's constraint: `{ amount: <spec> }`. */
function judgeFieldSpec(
  meta: NumberComparandDoorFieldMeta,
  field: string,
  spec: unknown,
  path: string,
): Outcome {
  // Not filter structure → an implicit-equality comparand, judged at this path.
  if (!isFilterNode(spec)) return judgeComparand(meta, field, spec, path);
  // A field spec with no `$` key is a deep-equality / nested-relation
  // condition; the #5869 gate records why descending into one would invent a
  // contract no backend agrees with.
  const ops = Object.keys(spec);
  if (!ops.some((op) => op.startsWith('$'))) return kept(spec);
  if (isFieldReference(spec)) return kept(spec);
  let out: Record<string, unknown> | undefined;
  for (const op of ops) {
    const comparand = spec[op];
    if (SCALAR_OPERATORS.has(op)) {
      const judged = judgeComparand(meta, field, comparand, `${path}.${op}`);
      if (!judged.ok) return judged;
      if (judged.value !== comparand) (out ??= { ...spec })[op] = judged.value;
      continue;
    }
    // A list operator whose comparand is not a list is the shape gate's
    // refusal, one door earlier; nothing is left here to judge.
    if (!LIST_OPERATORS.has(op) || !Array.isArray(comparand)) continue;
    let members: unknown[] | undefined;
    for (const [index, member] of comparand.entries()) {
      const judged = judgeComparand(meta, field, member, `${path}.${op}[${index}]`);
      if (!judged.ok) return judged;
      if (judged.value !== member) (members ??= [...comparand])[index] = judged.value;
    }
    if (members) (out ??= { ...spec })[op] = members;
  }
  return kept(out ?? spec);
}

/**
 * The walk, shared by every position: the node structure is judged the same
 * way wherever the condition sits; only {@link MetaOf} differs.
 *
 * Structure is discarded the same three conservative ways the sibling gates
 * discard it: `$and` / `$or` / `$not` are descended, any OTHER `$` key at node
 * level is skipped WITHOUT descending (an unrecognised combinator leaves the
 * fields beneath it ungated — a hole, not a false 400), and a dotted key names
 * a path this door does not judge. Copy-on-write throughout.
 */
function walkCondition(metaOf: MetaOf, node: unknown, path: string, depth: number): Outcome {
  if (depth > 32 || !isFilterNode(node)) return kept(node);
  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    let judged: Outcome;
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) continue;
      let arms: unknown[] | undefined;
      for (const [index, arm] of value.entries()) {
        const walked = walkCondition(metaOf, arm, `${here}[${index}]`, depth + 1);
        if (!walked.ok) return walked;
        if (walked.value !== arm) (arms ??= [...value])[index] = walked.value;
      }
      judged = kept(arms ?? value);
    } else if (key === '$not') {
      judged = walkCondition(metaOf, value, here, depth + 1);
    } else {
      if (key.startsWith('$') || key.includes('.')) continue;
      const meta = metaOf(key);
      // Only a judged field can refuse or narrow a comparand; a `formula`
      // whose return type is unreadable is `deferred`, and everything else is
      // `not-judged` — the spec's verdict, never a list here.
      if (!meta || numberComparandFieldVerdict(meta) !== 'judged') continue;
      judged = judgeFieldSpec(meta, key, value, here);
    }
    if (!judged.ok) return judged;
    if (judged.value !== value) (out ??= { ...node })[key] = judged.value;
  }
  return kept(out ?? node);
}

/** The judged fields of a `where` or a per-aggregation `filter`: the object's declared map. */
function declaredMetaOf(schema: unknown): MetaOf | null {
  // A registry-less host must not invent a verdict about a field map it cannot
  // see — the same early return every neighbour makes.
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  return (key) => (Object.prototype.hasOwnProperty.call(fields, key) ? fieldMetaOf(fields[key]) : null);
}

/**
 * Walk one `FilterCondition` and return the FIRST string a declared numeric
 * field cannot be compared with, or `null`.
 *
 * Exported for the same reason the sibling walks are: a consumer that needs to
 * ask "would the engine door refuse this?" without provoking the refusal.
 */
export function findNonNumericComparand(
  schema: unknown,
  where: unknown,
  path = 'where',
): NonNumericComparand | null {
  const metaOf = declaredMetaOf(schema);
  if (!metaOf) return null;
  const walked = walkCondition(metaOf, where, path, 0);
  return walked.ok ? null : walked.refusal;
}

function refuse(context: string, refusal: NonNumericComparand): never {
  throw invalidFilterError(numberComparandRefusalMessage(refusal, context));
}

/**
 * Refuse every string a declared numeric field cannot be compared with, and
 * narrow every numeric string to its number — `INVALID_FILTER` / 400, this
 * package's existing filter envelope, in the contract's words. No code is
 * minted.
 *
 * Returns `where` BY REFERENCE when nothing was narrowed, otherwise a copy:
 * the filter belongs to the caller and may be reused (view metadata, flow
 * node config).
 *
 * `path` roots the refusal at the position the filter sits in: `where` by
 * default, `aggregations[i].filter` for a per-aggregation filter.
 */
export function narrowNumberComparands<W>(
  object: string,
  operation: string,
  schema: unknown,
  where: W,
  path = 'where',
): W {
  const metaOf = declaredMetaOf(schema);
  if (!metaOf) return where;
  const walked = walkCondition(metaOf, where, path, 0);
  if (!walked.ok) refuse(`${operation}('${object}')`, walked.refusal);
  return walked.value as W;
}

/**
 * The `having` position: the same walk, the same verdict and the same words,
 * over the aggregated row's columns — judged when `classes` (#20127's
 * `aggregatedRowColumnClasses`, handed in rather than derived again) classes a
 * column `numeric`. Refuses or narrows exactly as {@link narrowNumberComparands}
 * does, rooted at `having`.
 */
export function narrowHavingNumberComparands<H>(
  object: string,
  having: H,
  classes: ReadonlyMap<string, AggregatedColumnClass | undefined>,
): H {
  const walked = walkCondition(
    (key) => (classes.get(key) === 'numeric' ? { type: 'number' } : null),
    having,
    'having',
    0,
  );
  if (!walked.ok) refuse(`aggregate('${object}')`, walked.refusal);
  return walked.value as H;
}
