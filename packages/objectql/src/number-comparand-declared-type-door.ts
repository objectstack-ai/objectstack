// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20351] The NUMBER-comparand declared-type door, at the engine's single
 * filter collection point: the fifth gate on the seam that already carries
 * the #5869 comparand-shape gate, the #8296 unmaterializable-field gate, the
 * #15661 text-operator declared-type gate and the #8690 temporal-comparand
 * gate. It answers a fifth question about the same predicate: *is this
 * comparand a number the column can be compared with.* [#20502] widened the
 * question from strings to every comparand, in the spec's verdict alone: a
 * boolean, a `Date` and an array are refused beside a non-numeric string,
 * and this file changed only to carry a refused value that is not a string.
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
 * - **Refuse** a string the grammar does not read as a number, and a boolean,
 *   a `Date` or an array (#20502): `INVALID_FILTER` / 400, the existing filter
 *   envelope, in the contract's words, before any driver is resolved. A value
 *   outside the comparand-type door's accepted set (`undefined`, a plain
 *   object, a `Map`) passes the verdict and is refused by that door, one call
 *   later, in its own words. A `{placeholder}` is refused too, unresolved: every
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
 *   fields, since that filter narrows the object's raw rows — a REAL declared
 *   field, so its refusal reads "a declared … field", same as `where`'s. But
 *   the engine evaluates it itself, per source row, never through a driver
 *   bind, so [#20510] its refusal names no PostgreSQL clause
 *   ({@link AGGREGATION_FILTER_SITE}).
 * - **`having`** ({@link narrowHavingNumberComparands}). The engine evaluates
 *   it over the aggregated rows, so the column is the aggregated one: judged
 *   when #20127's `aggregatedRowColumnClasses` classes it `numeric` (a `count`
 *   / `sum` / `avg`, and a groupBy or `min` / `max` of a numeric field). Such
 *   a column has no declared `FieldType` of its own; the verdict is handed
 *   `number`, the member of the numeric class it holds. [#20510] Its refusal
 *   names it "a numeric aggregated column" and, like the per-aggregation
 *   `filter`, carries no PostgreSQL clause ({@link HAVING_SITE}).
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
 * ## [#20546] The walk's second arm
 *
 * The walk below is the one filter walk the engine runs at all three
 * positions with each column's declaration in hand, so it also carries the
 * no-operator-object arm (`no-operator-object-door.ts`): a plain object with
 * no `$` key where a value of a column holding scalar values belongs — any
 * such column, not only a numeric one — is refused with `INVALID_FILTER` /
 * 400, naming the field and the path. It is asked first at every field key;
 * the number arm reads what it lets through. That module holds the arm's
 * classification and words; ⛔ nothing there walks a filter. [#20745] The
 * same arm now judges a relation column (the nested-relation form no driver
 * serves) and a structured-JSON column (a whole-value match the drivers share
 * no meaning for), and a platform-provisioned column the declared map omits
 * (`id`, …): the same walk and the same three positions, words per kind.
 *
 * ## [#20802] …and the nested-relation arm, at `where` only
 *
 * The nested-relation form is SERVED at `where` (`relation-filter-lowering.ts`).
 * There a no-operator object beneath a relation column is not refused by the
 * arm above: it is admitted against the related object's declarations
 * (`admitRelationCondition` — one level, declared keys, a registered related
 * object) or refused in words of its own. The engine then walks the admitted
 * `where` again with this SAME walk ({@link mapRelationConditions}) to collect
 * each condition and, after reading the related object, to replace it — so the
 * door and the lowering find a condition at the same boundaries by
 * construction. The per-aggregation `filter` and `having` keep the refusal.
 *
 * @see numberComparandDoorVerdict — the pure verdict (lane 1, `@objectstack/spec`).
 * @see https://github.com/objectstack-ai/objectstack/issues/20336 (the contract)
 * @see https://github.com/objectstack-ai/objectstack/issues/20351 (this door)
 * @see https://github.com/objectstack-ai/objectstack/issues/20510 (the site kind and the driver-bound clause)
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
import {
  declaredNoOperatorObjectColumn,
  isNoOperatorObject,
  noOperatorObjectColumnKind,
  noOperatorObjectRefusalMessage,
  provisionedNoOperatorObjectColumn,
  type NoOperatorObjectColumn,
  type NoOperatorObjectRefusal,
} from './no-operator-object-door.js';
import {
  admitRelationCondition,
  relationConditionRefusalMessage,
  type RelationConditionRefusal,
  type RelationFilterSite,
  type RelationReplacement,
} from './relation-filter-lowering.js';

/** The operators whose one comparand is judged — the contract's list, never a re-listing. */
const SCALAR_OPERATORS: ReadonlySet<string> = new Set(NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS);

/** The operators each of whose MEMBERS is judged as a comparand in its own right. */
const LIST_OPERATORS: ReadonlySet<string> = new Set(NUMBER_COMPARAND_DOOR_LIST_OPERATORS);

/** A comparand the door refuses: the site the contract's words are written from. */
export type NonNumericComparand = NumberComparandRefusalSite;

/**
 * What one filter position supplies to the walk about a KEY: the two facts its
 * two arms read, or `null` when the key names no column the position knows.
 */
interface KeyFacts {
  /** The number arm's field meta — `null` when that arm has nothing to judge here. */
  readonly number: NumberComparandDoorFieldMeta | null;
  /**
   * [#20546] The column the no-operator-object arm judges — else `null`.
   * [#20745] Any of its three kinds (a scalar-valued, a relation or a
   * structured-JSON column), each refused in words of its own.
   */
  readonly column: NoOperatorObjectColumn | null;
}

/** What one filter position supplies to the walk: the facts a KEY names, or `null`. */
type FactsOf = (key: string) => KeyFacts | null;

/**
 * [#20510] What the CALLER already knows about the position being walked —
 * the two facts the spec's words need and this door alone has: whether the
 * column is a real declared field or an aggregated-row column with none of
 * its own ({@link NumberComparandRefusalSite.aggregated}), and whether this
 * position ever reaches a live driver bind
 * ({@link NumberComparandRefusalSite.boundByDriver}). One per call to
 * {@link narrowNumberComparands} / {@link narrowHavingNumberComparands} /
 * {@link findNonNumericComparand} — never per field, so the walk carries it
 * through unchanged.
 */
interface RefusalSiteContext {
  readonly aggregated: boolean;
  readonly boundByDriver: boolean;
  /**
   * [#20802] This position serves the nested-relation form: a no-operator
   * object beneath a relation column is a condition on the related object,
   * admitted structurally ({@link admitRelationCondition}) and lowered by the
   * engine. Only `where` does; the per-aggregation `filter` and `having` keep
   * the no-operator-object refusal (see `relation-filter-lowering.ts`).
   */
  readonly servesRelations: boolean;
}

/** `where`, both spellings: a real declared field, and the driver binds it. */
const WHERE_SITE: RefusalSiteContext = { aggregated: false, boundByDriver: true, servesRelations: true };
/** The per-aggregation `filter`: a real declared field, but the engine evaluates it itself. */
const AGGREGATION_FILTER_SITE: RefusalSiteContext = { aggregated: false, boundByDriver: false, servesRelations: false };
/** `having`: an aggregated-row column, evaluated by the engine, never bound. */
const HAVING_SITE: RefusalSiteContext = { aggregated: true, boundByDriver: false, servesRelations: false };

/**
 * [#20802] What the walk needs, beyond one position's facts, to serve the
 * nested-relation form at `where`.
 */
export interface RelationArm {
  /**
   * The related object's declared schema, by name — the engine's registry.
   * Absent, or answering nothing, and a condition beneath a relation is
   * refused: its keys cannot be judged against a field map nobody supplied.
   */
  readonly schemaOf?: (name: string) => unknown;
  /**
   * LOWERING only: what replaces an admitted condition. Absent at the door,
   * where an admitted condition is kept as written for the engine to lower.
   */
  readonly replace?: (site: RelationFilterSite) => RelationReplacement;
}

/** One walk's context: the position, and — at `where` — the relation arm. */
interface WalkContext extends RefusalSiteContext {
  readonly relations?: RelationArm;
  /**
   * [#20802] The lowering pass: only admitted relation conditions are
   * rewritten. The number arm is not asked again — the door already narrowed
   * every comparand it judges, and a second pass must not narrow twice.
   */
  readonly lowerOnly?: boolean;
}

/** The first refusal the walk met, and which arm raised it. */
type Refusal =
  | { readonly arm: 'number'; readonly site: NonNumericComparand }
  | { readonly arm: 'no-operator-object'; readonly site: NoOperatorObjectRefusal }
  | { readonly arm: 'relation'; readonly site: RelationConditionRefusal };

/** The walk's answer: the (possibly narrowed) node, or the first refusal. */
type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly refusal: Refusal };

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

/**
 * One comparand at a judged position: the spec's verdict, routed. Whatever
 * the comparand is — a string, a boolean, a `Date`, an array (#20502) — the
 * verdict alone decides; this function only turns its answer into an outcome.
 */
function judgeComparand(
  meta: NumberComparandDoorFieldMeta,
  field: string,
  comparand: unknown,
  path: string,
  ctx: RefusalSiteContext,
): Outcome {
  const verdict = numberComparandDoorVerdict(meta, comparand);
  if (verdict.verdict === 'narrows') return kept(verdict.value);
  if (verdict.verdict !== 'door-refusal') return kept(comparand);
  return {
    ok: false,
    refusal: { arm: 'number', site: {
      field,
      declaredType: meta.type,
      ...(meta.returnType === undefined ? {} : { returnType: meta.returnType }),
      path,
      value: comparand,
      form: verdict.form,
      // [#20510] Only ever written when true — an unset `aggregated` /
      // `boundByDriver` reads as the pre-#20510 default (a declared field,
      // driver-bound), which is exactly what `WHERE_SITE` above says.
      ...(ctx.aggregated ? { aggregated: true as const } : {}),
      ...(ctx.boundByDriver ? {} : { boundByDriver: false as const }),
    } },
  };
}

/** One judged field's constraint: `{ amount: <spec> }`. */
function judgeFieldSpec(
  meta: NumberComparandDoorFieldMeta,
  field: string,
  spec: unknown,
  path: string,
  ctx: RefusalSiteContext,
): Outcome {
  // Not filter structure → an implicit-equality comparand, judged at this path.
  if (!isFilterNode(spec)) return judgeComparand(meta, field, spec, path, ctx);
  // A field spec with no `$` key is a deep-equality / nested-relation
  // condition; the #5869 gate records why descending into one would invent a
  // contract no backend agrees with. [#20546] Under a column that holds
  // scalar values — every numeric type — the walk's no-operator-object arm
  // refuses one before this function is called; what still reaches this line
  // sits under a column that arm does not judge (a `formula`, refused a door
  // earlier).
  const ops = Object.keys(spec);
  if (!ops.some((op) => op.startsWith('$'))) return kept(spec);
  if (isFieldReference(spec)) return kept(spec);
  let out: Record<string, unknown> | undefined;
  for (const op of ops) {
    const comparand = spec[op];
    if (SCALAR_OPERATORS.has(op)) {
      const judged = judgeComparand(meta, field, comparand, `${path}.${op}`, ctx);
      if (!judged.ok) return judged;
      if (judged.value !== comparand) (out ??= { ...spec })[op] = judged.value;
      continue;
    }
    // A list operator whose comparand is not a list is the shape gate's
    // refusal, one door earlier; nothing is left here to judge.
    if (!LIST_OPERATORS.has(op) || !Array.isArray(comparand)) continue;
    let members: unknown[] | undefined;
    for (const [index, member] of comparand.entries()) {
      const judged = judgeComparand(meta, field, member, `${path}.${op}[${index}]`, ctx);
      if (!judged.ok) return judged;
      if (judged.value !== member) (members ??= [...comparand])[index] = judged.value;
    }
    if (members) (out ??= { ...spec })[op] = members;
  }
  return kept(out ?? spec);
}

/**
 * The walk, shared by every position: the node structure is judged the same
 * way wherever the condition sits; only {@link FactsOf} differs.
 *
 * [#20546] It carries TWO arms, asked in order at every field key: the
 * no-operator-object arm (`no-operator-object-door.ts` — a plain object with
 * no `$` key where a scalar column's value belongs), then the number arm
 * ({@link judgeFieldSpec}). [#20802] At `where` the first arm hands a relation
 * column's object to the nested-relation admission instead, and the lowering
 * pass ({@link WalkContext.lowerOnly}) asks that question alone. One traversal, one set of boundaries (the depth
 * bound, the combinators descended, the `$` and dotted keys skipped), two
 * questions — the shape the spec's save-door walk takes for its own arms
 * (`checkFilterConditionComparands`: "One walk, one set of boundaries, `n`
 * arms"). A second walk would have to redraw every one of those boundaries,
 * and the two copies would part the first time one moved.
 *
 * Structure is discarded the same three conservative ways the sibling gates
 * discard it: `$and` / `$or` / `$not` are descended, any OTHER `$` key at node
 * level is skipped WITHOUT descending (an unrecognised combinator leaves the
 * fields beneath it ungated — a hole, not a false 400), and a dotted key names
 * a path this door does not judge. Copy-on-write throughout.
 */
function walkCondition(factsOf: FactsOf, node: unknown, path: string, depth: number, ctx: WalkContext): Outcome {
  if (depth > 32 || !isFilterNode(node)) return kept(node);
  let out: Record<string, unknown> | undefined;
  // [#20802] Lowered multi-valued relation conditions, AND-ed into this node
  // in place of their field entries once every key has been walked.
  let clauses: FilterClause[] | undefined;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    let judged: Outcome;
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) continue;
      let arms: unknown[] | undefined;
      for (const [index, arm] of value.entries()) {
        const walked = walkCondition(factsOf, arm, `${here}[${index}]`, depth + 1, ctx);
        if (!walked.ok) return walked;
        if (walked.value !== arm) (arms ??= [...value])[index] = walked.value;
      }
      judged = kept(arms ?? value);
    } else if (key === '$not') {
      judged = walkCondition(factsOf, value, here, depth + 1, ctx);
    } else {
      if (key.startsWith('$') || key.includes('.')) continue;
      const facts = factsOf(key);
      if (!facts) continue;
      // [#20546] The no-operator-object arm, first: filter structure where a
      // scalar column's value belongs can match no record on any backend, so
      // it is refused whichever arm would otherwise read the value. [#20745]
      // Beneath a relation or a structured-JSON column too: no driver serves
      // the nested-relation form, and none shares a meaning for a whole-value
      // match.
      if (facts.column !== null && isNoOperatorObject(value)) {
        // [#20802] …except beneath a relation column at a position that serves
        // the nested-relation form (`where`): there it is a condition on the
        // related object, admitted by its declarations — or refused, loudly,
        // in words of its own — and, in the lowering pass, rewritten.
        if (ctx.servesRelations && facts.column.kind === 'relation' && facts.column.def !== undefined) {
          const admitted = admitRelationCondition(key, facts.column.def, value, here, ctx.relations?.schemaOf);
          if (!admitted.ok) return { ok: false, refusal: { arm: 'relation', site: admitted.refusal } };
          const replace = ctx.relations?.replace;
          if (!replace) continue;
          const replacement = replace(admitted.site);
          if (replacement.kind === 'clause') {
            (clauses ??= []).push(replacement.clause);
            delete (out ??= { ...node })[key];
            continue;
          }
          judged = kept(replacement.value);
        } else {
          return {
            ok: false,
            refusal: {
              arm: 'no-operator-object',
              site: { field: key, column: facts.column, path: here, keys: Object.keys(value), aggregated: ctx.aggregated },
            },
          };
        }
      } else {
        if (ctx.lowerOnly) continue;
        const meta = facts.number;
        // Only a judged field can refuse or narrow a comparand; a `formula`
        // whose return type is unreadable is `deferred`, and everything else is
        // `not-judged` — the spec's verdict, never a list here.
        if (!meta || numberComparandFieldVerdict(meta) !== 'judged') continue;
        judged = judgeFieldSpec(meta, key, value, here, ctx);
      }
    }
    if (!judged.ok) return judged;
    if (judged.value !== value) (out ??= { ...node })[key] = judged.value;
  }
  if (clauses) return kept(withClauses(out ?? { ...node }, clauses));
  return kept(out ?? node);
}

/** A condition the lowering AND-s into a node in place of a field entry. */
type FilterClause = Record<string, unknown>;

/**
 * [#20802] AND `clauses` into `node` (a copy the walk owns): appended to the
 * node's own `$and` when it has one, else as a new `$and`. A node whose `$and`
 * is not a list — a shape the doors refuse, kept for them — is wrapped instead,
 * so nothing it carries is overwritten.
 */
function withClauses(node: Record<string, unknown>, clauses: readonly FilterClause[]): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(node, '$and')) return { ...node, $and: [...clauses] };
  const existing = node.$and;
  if (Array.isArray(existing)) return { ...node, $and: [...existing, ...clauses] };
  return { $and: [node, ...clauses] };
}

/** The judged fields of a `where` or a per-aggregation `filter`: the object's declared map. */
function declaredFactsOf(schema: unknown): FactsOf | null {
  // A registry-less host must not invent a verdict about a field map it cannot
  // see — the same early return every neighbour makes.
  const fields = (schema as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields || typeof fields !== 'object') return null;
  return (key) => {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) {
      // [#20745] A platform-provisioned column the map omits (`id`, …) is a
      // column all the same, and the arm judges it by the type it stores;
      // every other undeclared key keeps the registry-less tolerance.
      const provisioned = provisionedNoOperatorObjectColumn(key);
      return provisioned === null ? null : { number: null, column: provisioned };
    }
    const meta = fieldMetaOf(fields[key]);
    if (!meta) return null;
    return { number: meta, column: declaredNoOperatorObjectColumn(fields[key]) };
  };
}

/**
 * Walk one `FilterCondition` and return the FIRST comparand a declared numeric
 * field cannot be compared with, or `null`.
 *
 * Exported for the same reason the sibling walks are: a consumer that needs to
 * ask "would the engine door refuse this?" without provoking the refusal.
 * [#20546] The number arm's answer only: when the walk's first refusal is the
 * no-operator-object arm's, this answers `null` — {@link narrowNumberComparands}
 * is the call that raises either.
 */
export function findNonNumericComparand(
  schema: unknown,
  where: unknown,
  path = 'where',
): NonNumericComparand | null {
  const factsOf = declaredFactsOf(schema);
  if (!factsOf) return null;
  // [#20510] Every caller of this walk (`where`, the per-aggregation `filter`)
  // reads a real declared field; only `where` itself ever binds to a driver.
  const walked = walkCondition(factsOf, where, path, 0, path === 'where' ? WHERE_SITE : AGGREGATION_FILTER_SITE);
  return walked.ok || walked.refusal.arm !== 'number' ? null : walked.refusal.site;
}

function refuse(context: string, refusal: Refusal): never {
  throw invalidFilterError(
    refusal.arm === 'number'
      ? numberComparandRefusalMessage(refusal.site, context)
      : refusal.arm === 'relation'
        ? relationConditionRefusalMessage(refusal.site, context)
        : noOperatorObjectRefusalMessage(refusal.site, context),
  );
}

/**
 * Refuse every comparand a declared numeric field cannot be compared with, and
 * narrow every numeric string to its number — `INVALID_FILTER` / 400, this
 * package's existing filter envelope, in the contract's words. No code is
 * minted.
 *
 * Returns `where` BY REFERENCE when nothing was narrowed, otherwise a copy:
 * the filter belongs to the caller and may be reused (view metadata, flow
 * node config).
 *
 * `path` roots the refusal at the position the filter sits in: `where` by
 * default, `aggregations[i].filter` for a per-aggregation filter — both read
 * the object's real declared fields, so the refusal names one honestly
 * (`WHERE_SITE`); only `where` itself ever reaches a live driver bind, so the
 * not-a-number / boolean / date clauses name PostgreSQL's server error there
 * alone (#20510).
 */
export function narrowNumberComparands<W>(
  object: string,
  operation: string,
  schema: unknown,
  where: W,
  path = 'where',
  relations?: Pick<RelationArm, 'schemaOf'>,
): W {
  const factsOf = declaredFactsOf(schema);
  if (!factsOf) return where;
  // [#20802] At `where`, a condition beneath a relation column is ADMITTED
  // here, against the related object's declarations (`relations.schemaOf`),
  // and kept as written: the engine lowers it once it can read
  // ({@link mapRelationConditions}). Without the related object's schema it is
  // refused — the door cannot judge keys against a field map it was not given.
  const ctx: WalkContext = path === 'where'
    ? { ...WHERE_SITE, relations: relations?.schemaOf ? { schemaOf: relations.schemaOf } : undefined }
    : AGGREGATION_FILTER_SITE;
  const walked = walkCondition(factsOf, where, path, 0, ctx);
  if (!walked.ok) refuse(`${operation}('${object}')`, walked.refusal);
  return walked.value as W;
}

/**
 * [#20802] The LOWERING pass over a `where` the door already admitted: the same
 * walk, at the same boundaries, asking one question — is this a nested-relation
 * condition — and handing each one it admits to `relations.replace`, whose
 * answer takes its place (a new value for the field, or a clause AND-ed into
 * its node). Nothing else is judged or narrowed again. Copy-on-write: returns
 * `where` by reference when it holds no condition.
 *
 * The engine calls it twice per filter position that holds a condition: once
 * to COLLECT the admitted conditions (a `replace` that records each site and
 * returns it unchanged, whose output is discarded), and — after the related
 * reads — once to REPLACE them, in the same order. One walk, so the two passes
 * and the door cannot disagree about where a condition is.
 *
 * A condition this pass cannot admit is refused in the door's words: the door
 * ran the same admission on the same declarations, so that is unreachable
 * unless the filter changed between the two (a hook, a middleware) — and then
 * the refusal is the right answer rather than a nested form reaching a driver.
 */
export function mapRelationConditions<W>(
  object: string,
  operation: string,
  schema: unknown,
  where: W,
  relations: Required<RelationArm>,
): W {
  const factsOf = declaredFactsOf(schema);
  if (!factsOf) return where;
  const walked = walkCondition(factsOf, where, 'where', 0, { ...WHERE_SITE, relations, lowerOnly: true });
  if (!walked.ok) refuse(`${operation}('${object}')`, walked.refusal);
  return walked.value as W;
}

/**
 * The `having` position: the same walk, the same verdict and the same words,
 * over the aggregated row's columns — judged when `classes` (#20127's
 * `aggregatedRowColumnClasses`, handed in rather than derived again) classes a
 * column `numeric`. Refuses or narrows exactly as {@link narrowNumberComparands}
 * does, rooted at `having`.
 *
 * [#20510] The column here — an aggregation alias or a groupBy projection —
 * has no declared `FieldType` of its own even when it merely carries a real
 * field's value through: it is the AGGREGATED ROW's column, not the record's
 * field. The refusal names it "a numeric aggregated column"
 * ({@link HAVING_SITE}), and — like the per-aggregation `filter` — the engine
 * evaluates `having` itself, never the driver, so it carries no PostgreSQL
 * clause either.
 *
 * [#20546] `types` (`aggregatedRowColumnTypes`, from the same reading of the
 * query as `classes`) is what the walk's no-operator-object arm reads here:
 * the column's type, since the class lumps a `json` or `lookup` groupBy in
 * with a text column. Its refusal names the aggregated column too. [#20745]
 * A `json` or `lookup` groupBy (or a `min` / `max` of one) is judged now, by
 * that same type: the engine evaluates `having` itself, and a relation column
 * there carries the related record's id, never the record — measured, a
 * nested-relation `having` kept no group on every driver. [#20783] A `json`
 * GROUPBY no longer reaches here: `aggregate` refuses it at its entry
 * (`group-by-structured-json-door.ts`); a `min` / `max` of a json field does.
 */
export function narrowHavingNumberComparands<H>(
  object: string,
  having: H,
  classes: ReadonlyMap<string, AggregatedColumnClass | undefined>,
  types: ReadonlyMap<string, string | undefined>,
): H {
  const walked = walkCondition(
    (key) => {
      const type = types.get(key);
      const kind = type === undefined ? null : noOperatorObjectColumnKind(type);
      return {
        number: classes.get(key) === 'numeric' ? { type: 'number' } : null,
        column: kind === null ? null : { kind, type: type as string },
      };
    },
    having,
    'having',
    0,
    HAVING_SITE,
  );
  if (!walked.ok) refuse(`aggregate('${object}')`, walked.refusal);
  return walked.value as H;
}
