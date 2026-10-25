/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Filter Converter Utilities
 *
 * Shared utilities for converting MongoDB-like filter operators
 * to ObjectStack FilterNode AST format.
 */

import {
  normalizeFilterOperator,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_LIST_VALUE_OPERATORS,
  VIEW_FILTER_PAIR_VALUE_OPERATORS,
} from '@objectstack/spec/ui';
import { isAcceptedFilterComparand, ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE } from '@objectstack/spec/data';
import { isRefusedTextComparand, textComparandRefusalReason } from './text-comparand.js';

/**
 * FilterNode AST type definition
 * Represents a filter condition or a logical combination of conditions
 * 
 * @example
 * // Simple condition
 * ['status', '=', 'active']
 * 
 * // Logical combination
 * ['and', ['age', '>=', 18], ['status', '=', 'active']]
 */
export type FilterNode = 
  | [string, string, any]  // [field, operator, value]
  | [string, ...FilterNode[]];  // [logic, ...conditions]

/**
 * Map MongoDB-like operators to ObjectStack filter operators.
 * 
 * @param operator - MongoDB-style operator (e.g., '$gte', '$in')
 * @returns ObjectStack operator or null if not recognized
 */
/**
 * What the refusal is ABOUT, as structured data rather than as prose to scrape.
 *
 * `message` already names both, but a renderer that wants to say "the
 * $icontains condition cannot be applied" must not recover the token with a
 * regular expression over an English paragraph that every one of these
 * refusals deliberately writes differently. objectui#9050's step 2 requires the
 * render-time diagnostic to NAME the operator, so the name travels as a field.
 *
 * `operator` is the spelling the AUTHOR wrote — `$startswith` for a retired
 * alias, `icontains` for a view rule — never a canonical form substituted for
 * it, for the reason the view-rule arm's own tail already gives: prescribing a
 * spelling the author's vocabulary does not have sends them looking for a key
 * their metadata cannot contain.
 *
 * It is OPTIONAL because some refusals are not about an operator at all: the
 * bare-array and exotic-comparand arms judge a COMPARAND written in the
 * implicit-equality position, and the empty-operator-map arm judges a field
 * that names NO operator (`{ a: {} }`, objectui#9164). In each, no operator was
 * spelled and `field` is the only handle the author can act on. A renderer
 * reads {@link filterRefusalSubject} rather than choosing between them itself.
 */
export interface FilterRefusalSubject {
  /** The operator spelling the author wrote, when the refusal is about one. */
  operator?: string;
  /** The field the refused condition is on, when the refusal is about one. */
  field?: string;
}

/**
 * A filter operator this layer will not translate.
 *
 * Carries the data API's own code and status for the same refusal so a failed
 * list renders "the filter is malformed" rather than "check your connection" —
 * `classifyLoadError` reads these, and a bare `Error` classifies as a network
 * fault, which is the one thing this is definitely not.
 */
export class FilterOperatorError extends Error {
  readonly code = 'INVALID_FILTER';
  readonly httpStatus = 400;
  /** @see FilterRefusalSubject */
  readonly operator: string | undefined;
  /** @see FilterRefusalSubject */
  readonly field: string | undefined;
  constructor(message: string, subject?: FilterRefusalSubject) {
    super(message);
    this.name = 'FilterOperatorError';
    this.operator = subject?.operator;
    this.field = subject?.field;
  }
}

/**
 * The one token a "this view's filter is malformed" state names.
 *
 * Operator first, because that is what the ruling asks the state to name and
 * what an author can act on — `$regex` is not supported, `$startswith` is
 * retired. Field second, for the refusals that have no operator to name — the
 * two comparand arms and the empty operator map. `undefined` for neither, which no arm produces today and which a
 * renderer must still handle rather than print "undefined" at a user.
 */
export function filterRefusalSubject(error: FilterOperatorError): string | undefined {
  return error.operator ?? error.field ?? undefined;
}

/**
 * The four lowercase `$`-dialect spellings this file used to accept "for
 * tolerance", and the canonical spelling each author meant.
 *
 * RETIRED by objectui#8568, on the maintainer's ruling that this project follows
 * the ObjectStack protocol and its documentation follows the implementation.
 * They were a renderer-side second dialect — exactly what AGENTS.md #0.1
 * refuses, and the same ground objectui#8447 stood on when it declined to teach
 * the in-memory matcher the same arms ("would fossilise a second dialect").
 * Until now `convertFiltersToAST` accepted them while `ValueDataSource` refused
 * them, so ONE authored filter had two fates depending on which data source was
 * behind the view. One dialect, one spelling.
 *
 * Refused BY NAME rather than dropped into the unknown-operator arm below,
 * because the two answers cost an author very different amounts: "unknown
 * operator, here is the supported list" makes them diff two lists and guess
 * which entry they meant, while "write `$startsWith`" IS the repair. There is no
 * deprecation window (maintainer, 2026-08-27), so this message is the entire
 * migration aid — the reason it is worth spelling out.
 *
 * ⛔ Not a lowering table in disguise: nothing reads the value as an operator.
 * Every VALUE is a member of the spec's `FILTER_OPERATORS` and every KEY is
 * absent from it, and both directions are EXECUTED against
 * `@objectstack/spec` in `filter-alias-retirement-8568.test.ts` rather than
 * restated here, so this map cannot drift into prescribing a spelling the spec
 * does not declare.
 */
const RETIRED_OPERATOR_ALIASES: Record<string, string> = {
  '$notin': '$nin',
  '$notcontains': '$notContains',
  '$startswith': '$startsWith',
  '$endswith': '$endsWith',
};

export function convertOperatorToAST(operator: string): string | null {
  // Spec reference: framework/packages/spec/src/data/filter.zod.ts
  // Every key below is a canonical `FILTER_OPERATORS` spelling and nothing else.
  // The four lowercase aliases that used to sit here are retired and refused by
  // name (objectui#8568) — see RETIRED_OPERATOR_ALIASES above.
  const operatorMap: Record<string, string> = {
    '$eq': '=',
    '$ne': '!=',
    '$gt': '>',
    '$gte': '>=',
    '$lt': '<',
    '$lte': '<=',
    '$in': 'in',
    '$nin': 'nin',
    '$between': 'between',
    '$contains': 'contains',
    '$notContains': 'notcontains',
    '$startsWith': 'startswith',
    '$endsWith': 'endswith',
    // Case-insensitive contains. A canonical `FILTER_OPERATORS` member that
    // `ValueDataSource` executes and `FilterConditionField` emits (for its
    // `icontains` builder row — spelled `containsCaseInsensitive` until
    // objectui#9306), while this map refused it with the
    // generic unknown-operator paragraph — so ONE authored filter selected rows
    // through the in-memory matcher and 400'd on the ObjectStack lowering path
    // (objectui#8976). The other direction of the same split objectui#8568 fixed:
    // there the map was MORE tolerant than the matcher, here it was LESS tolerant
    // than the contract. Restored by aligning the map with the spec, per AGENTS.md
    // #0 — not by removing the operator from the builder, which the spec declares.
    //
    // The VALUE is an IDENTITY, and that is not a typo: `icontains` is itself a
    // member of the spec's `VALID_AST_OPERATORS`, so unlike its camelCase siblings
    // above there is no case to squash. Same identity row, for the same stated
    // reason, that `FILTER_OPERATOR_ALIASES` carries in
    // `packages/data-objectstack/src/index.ts`.
    '$icontains': 'icontains',
  };
  
  return operatorMap[operator] || null;
}

/**
 * The `FilterCondition` combinators this lowering can carry, and the AST
 * keyword each becomes.
 *
 * The vocabulary is the spec's, not a second list: `FILTER_ARRAY_LOGIC_KEYWORDS`
 * (`@objectstack/spec/data`) is `['and', 'or']` — measured — and those two are
 * exactly the heads `isFilterAST` opens a group on. `$not` is absent from it,
 * which is why it has no row here and is refused below rather than translated.
 */
const AST_LOGIC_KEYWORD: Record<string, 'and' | 'or'> = {
  $and: 'and',
  $or: 'or',
};

/**
 * Lower ONE `$and` / `$or` group to an AST group node.
 *
 * Returns `undefined` when the group is the TRUE identity and therefore
 * constrains nothing, so the caller drops it instead of emitting a childless
 * `['and']` — which is NOT the same thing. Measured against the spec's own
 * doors: `isFilterAST(['and'])` is `false` and `parseFilterAST(['and'])` is
 * `undefined`, i.e. NO FILTER — every row. A combinator that reduces to "no
 * constraint" must therefore disappear at THIS level; emitting an empty group
 * would widen the result set, which is the one failure direction this file
 * exists to avoid.
 *
 * `objectstack-ai/objectstack#5322` (maintainer ruling 2026-08-04, recorded on `FilterConditionSchema`)
 * fixes the identities: `{ $and: [] }` is TRUE, `{ $or: [] }` is FALSE, and a
 * `{}` disjunct is TRUE and ABSORBS its `$or`. TRUE is expressible here — it is
 * the absence of a constraint. FALSE is not: the AST has no contradiction
 * literal, so `{ $or: [] }` keeps the emission it already had (see
 * {@link falseIdentityLeaf}).
 */
function lowerLogicalGroup(
  field: string,
  keyword: 'and' | 'or',
  value: unknown,
): FilterNode | undefined {
  if (!Array.isArray(value)) {
    throw new FilterOperatorError(
      `[ObjectUI] The '${field}' filter combinator takes an ARRAY of conditions. ` +
      `Received ${typeof value === 'object' ? 'an object' : typeof value}: ` +
      `${JSON.stringify(value)}. Spec: FilterCondition declares ` +
      `'${field}?: FilterCondition[]' (data/filter.zod.ts).`,
      { operator: field },
    );
  }

  if (value.length === 0) {
    return keyword === 'and' ? undefined : falseIdentityLeaf(field, value);
  }

  const children: FilterNode[] = [];
  // Set when an `$or` member is the TRUE identity. Recorded, not returned
  // on the spot (objectui#10789): the members AFTER it still have to be read,
  // or a malformed one is refused only when it happens to come FIRST —
  // `{ $or: [{ a: {} }, {}] }` refused while `{ $or: [{}, { a: {} }] }`
  // answered TRUE, the same two members with two fates. The absorption itself
  // is unchanged; it is decided after the loop, once every member was judged.
  let absorbed = false;
  for (const child of value) {
    if (child === null || typeof child !== 'object' || Array.isArray(child)) {
      throw new FilterOperatorError(
        `[ObjectUI] Every member of '${field}' must be a filter condition OBJECT. ` +
        `Received ${JSON.stringify(child)}. Spec: FilterCondition declares ` +
        `'${field}?: FilterCondition[]' (data/filter.zod.ts).`,
        { operator: field },
      );
    }
    const lowered = convertFiltersToAST(child as Record<string, any>);
    if (!Array.isArray(lowered)) {
      // A child that produced no conditions comes back as a NON-ARRAY, in one
      // of two spellings: the ORIGINAL OBJECT for a `{}` disjunct, and
      // `undefined` for a child that is itself a TRUE-identity group
      // (`{ $and: [{ $and: [] }] }` — objectui#8770's tail below) or holds only
      // null/undefined values (objectui#9020). A child that is an EMPTY
      // OPERATOR MAP (`{ a: {} }`) never gets here: the same tail refuses it,
      // and the refusal propagates out of the whole filter (objectui#9164).
      // Both spellings mean the same thing here, which is
      // why the test is `Array.isArray` and not a comparison against either
      // spelling: that child is the TRUE identity (objectstack-ai/objectstack#5322), so it absorbs an
      // `$or` outright and drops out of an `$and`. It must not be pushed as a
      // child either way: an object in AST child position makes `isFilterAST`
      // false (measured), and the wire face answers `400 INVALID_FILTER` for
      // the whole filter.
      if (keyword === 'or') absorbed = true;
      continue;
    }
    children.push(lowered as FilterNode);
  }

  // A TRUE disjunct absorbs its `$or` (objectstack-ai/objectstack#5322) — now that every member was read.
  if (absorbed) return undefined;

  // Every conjunct reduced to TRUE, so the `$and` constrains nothing.
  if (children.length === 0) return undefined;

  // A one-child group is emitted as a group, not unwrapped. `['or', node]` is
  // accepted by `isFilterAST` (length >= 2 = keyword + one condition) and
  // `parseFilterAST` reduces it to the child, so the extra hop costs nothing
  // and keeps this function's output shape a function of the INPUT shape.
  return [keyword, ...children] as FilterNode;
}

/**
 * `{ $or: [] }` — FALSE, the OR identity (objectstack-ai/objectstack#5322) — as the leaf this file has
 * always emitted for it.
 *
 * Deliberately unchanged, and deliberately not a group node. Three measurements
 * against `@objectstack/spec` 17.3.0 and this repo's own evaluator decide it:
 *
 *   - `parseFilterAST(['$or', '=', []])` is `{ $or: [] }` — the FilterCondition
 *     the author wrote, which every backend reduces to zero rows. Correct.
 *   - `ValueDataSource`'s matcher reads it as a comparison on a field named
 *     `$or`, which no record has, so it excludes every row. Also correct, and
 *     the same answer.
 *   - `['or']` — the "obvious" empty group — is `isFilterAST` FALSE and
 *     `parseFilterAST` `undefined`: no filter at all, i.e. EVERY row. That is
 *     the widening direction, on a filter whose whole purpose is to hide rows
 *     (objectstack-ai/objectstack#5134), so it is the one shape that must not be emitted.
 *
 * A leaf naming `$or` as a field is not a shape to be proud of; it is the shape
 * that answers FALSE at both consumers, which the alternatives do not.
 */
function falseIdentityLeaf(field: string, value: unknown[]): FilterNode {
  return [field, '=', value] as FilterNode;
}

/**
 * Is `value` an OPERATOR MAP — the shape the operator loop reads — or a
 * comparand the author wrote?
 *
 * The loop's premise is that an object which is not an accepted comparand is a
 * map of `$` operators. That premise holds for exactly one population: a PLAIN
 * object, which is what an author writes and what `JSON.parse` of stored
 * metadata produces. An exotic instance — `RegExp`, `Set`, `Map`, `URL`, a class
 * instance — is not a map of operators under any reading; it is a VALUE, and
 * `Object.entries` of each of those is `[]` (measured), which is why the loop
 * used to run zero times and push NO condition for the field.
 *
 * The PROTOTYPE is the test, deliberately, and not `Object.keys(value).length
 * === 0`: zero own entries is exactly what `{}` and `/x/` have in COMMON, and
 * they need different answers — `{}` is an operator map that names no
 * operator, refused as such (objectui#9164 / objectui#10788), while `/x/` is a
 * VALUE the spec does not accept as a comparand, refused as that — and a keys
 * count cannot tell the two apart. Prototype can. (Until objectui#10788 `{}`
 * beside a key that lowers was the TRUE identity that constrained nothing,
 * pinned in filter-date-comparand-8555.test.ts section 4; that row now pins
 * the refusal.)
 *
 * The second hop admits a CROSS-REALM plain object (an iframe, a `vm` context),
 * whose prototype is that realm's `Object.prototype` rather than this one's: a
 * plain object's prototype has a null prototype, while a `RegExp`'s chain is one
 * link longer. So the test is about SHAPE, not about object identity.
 *
 * A plain object with no entries stays an operator map with no operators,
 * whatever else it happens to be. That boundary is deliberate:
 * this predicate separates values from operator maps, and it is not a second
 * opinion about the identity objectui#5322 already ruled on. What the converter
 * then DOES with an operator map that has no operators is decided by its
 * caller, not here: it is refused wherever it appears (objectui#9164 alone,
 * objectui#10788 beside a key that lowers; see refuseEmptyOperatorMap).
 */
function isOperatorMap(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype || Object.getPrototypeOf(proto) === null;
}

/**
 * Name the offending comparand for the refusal message.
 *
 * `JSON.stringify` is what every other message in this file uses, and it is
 * useless here: it renders a `RegExp`, a `Set` and a `Map` all as `{}` — the
 * spec's own refusal prints `({})` for a RegExp for exactly this reason. The
 * constructor name plus `String(value)` prints `/abc/` for a pattern and falls
 * back to the type alone when the value has no useful text form.
 *
 * Every read is guarded: a refusal message must never itself throw, or the
 * loud failure this arm exists to produce becomes a different, confusing one.
 */
function describeExoticComparand(value: object): string {
  let name: unknown;
  let text: string | undefined;
  try {
    const proto = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null;
    name = proto?.constructor?.name;
  } catch {
    name = undefined;
  }
  if (typeof name !== 'string' || name === '') return 'an object of an unrecognised type';
  try {
    text = String(value);
  } catch {
    text = undefined;
  }
  return text && text !== `[object ${name}]` ? `a ${name} instance (${text})` : `a ${name} instance`;
}

/**
 * An `$icontains` comparand that is not a NON-EMPTY STRING —
 * `{ name: { $icontains: '' } }`, `{ name: { $icontains: 42 } }` (objectui#9001).
 *
 * ## Not this file's ruling, and not a new one
 *
 * `FILTER_TEXT_CASES` (`@objectstack/spec/data`) carries both shapes as
 * REJECTION rows rather than as row-set expectations, each with
 * `code: 'INVALID_FILTER'` and `mustMention: ['$icontains']`:
 *
 * > *an empty `$icontains` comparand is REFUSED* — "Every row contains the
 * > empty substring, so evaluating it is a predicate that constrains nothing —
 * > the widening [objectstack-ai/objectstack#5240] refused `{ field: {} }` over, one level in."
 *
 * > *a non-string `$icontains` comparand is REFUSED* — "Coercing 42 to `"42"`
 * > would answer a query nobody wrote; the declared comparand type is string."
 *
 * `ValueDataSource` has answered both since objectui#8748
 * (`refuseTextComparand`), so this is a PORT of a shipped, reviewed
 * implementation one data source over — deliberately NOT a second design.
 * Measured on `origin/main` `152f0a700` (objectui#8996 and objectui#9019 both
 * landed), both faces in one process:
 *
 * ```
 * $icontains ''   LOWER=["name","icontains",""]   MATCH=[] REFUSED(1)
 * $icontains 42   LOWER=["name","icontains",42]   MATCH=[] REFUSED(1)
 * ```
 *
 * One authored filter, refused by the in-memory matcher and lowered onto the
 * wire by the ObjectStack path — the same acceptance-set split objectui#8568 and
 * objectui#8976 each closed on the operator-KEY axis, here on the COMPARAND
 * axis. ⚠️ objectui#8996 did not open this door: before it the `$` dialect was
 * stopped by the generic unknown-operator arm, an accident rather than a
 * comparand ruling, while the object-form dialect
 * (`FILTER_OPERATOR_ALIASES` in `@object-ui/data-objectstack`) already lowered
 * the same node with no converter involved.
 *
 * ## What transfers from the sibling, and what cannot
 *
 * The DISCRIMINATION and the MESSAGE transfer verbatim, and the message is
 * load-bearing rather than cosmetic: `mustMention: ['$icontains']` means a
 * differently-worded refusal is a different failure to honour the same
 * contract, not a stylistic variant.
 * `filter-text-comparand-9001.test.ts` pins the two messages against each other
 * by DRIVING both faces and asserting this one contains the sibling's refusal
 * text, so the mirror cannot drift in silence.
 *
 * ⭐ Since objectui#9048 "transfer verbatim" is no longer a claim about two
 * copies agreeing: both halves are ONE implementation in `text-comparand.ts`,
 * and this function is the envelope that seats it. The pin above is kept, and
 * is now a pin on the SEATING rather than on a transcription.
 *
 * The DELIVERY cannot transfer, and that is the card's own Q1 answered by the
 * two call sites rather than by a fresh ruling. `ValueDataSource`
 * excludes-and-logs because it is deciding about one ROW and HAS a row to
 * exclude; this function is the PRODUCER deciding whether to send a query at
 * all, and has none. Its declared refusal shape is {@link FilterOperatorError},
 * which carries exactly the `INVALID_FILTER` / 400 envelope the spec rows
 * declare and which this file already uses for `$regex`, `$not`, the retired
 * aliases and three comparand shapes. Same code, same message, each face's own
 * envelope.
 *
 * ## Scope
 *
 * Only `$icontains`, because only `$icontains` is what the table declares. The
 * sibling positive operators (`$contains` / `$startsWith` / `$endsWith`) have no
 * such row and keep the answer they have always given here — the same boundary
 * `refuseTextComparand`'s own docblock draws one data source over. Widening it
 * by analogy is the published table's decision, not this file's, and the
 * asymmetry is pinned so the next reader sees a scope boundary rather than an
 * oversight.
 */
function refuseTextComparand(field: string, operator: string, target: unknown): never {
  const ported =
    `It is refused here rather than lowered onto the wire (objectui#9001; ported from `
    + `ValueDataSource's refuseTextComparand, objectui#8748).`;
  throw new FilterOperatorError(
    `[ObjectUI] The ${textComparandRefusalReason(field, operator, target)}. ${ported}`,
    { operator, field },
  );
}

/**
 * A field that names NO operator — `{ a: {} }` — wherever it appears in a
 * filter: alone (objectui#9164) or beside a key that lowers (objectui#10788).
 *
 * ## What it used to do
 *
 * The loop ENTERS the key — the value is a plain object, so it is an operator
 * map — and the operator loop runs zero times, so NO condition is pushed for
 * the field. What happened next depended on the field's SIBLINGS, the hazard
 * objectui#8555 named on this file:
 *
 * - beside a key that lowers, the sibling's condition carried the filter and
 *   the field VANISHED from it: `{ status: 'a', created: {} }` lowered to
 *   `['status', '=', 'a']`, byte-identical to `{ status: 'a' }` on both
 *   `find()` routes of `@object-ui/data-objectstack` — a result set WIDER than
 *   the author wrote, silently (objectui#10788);
 * - alone, the general tail handed back the CALLER'S ORIGINAL OBJECT, which
 *   reached those two routes as two different wrong requests: the plain route
 *   spread it into query parameters (`?a=[object Object]`, and no `filter`
 *   parameter at all), the `$expand` / `$search` route serialised it into
 *   `filter={"a":{}}` (objectui#9164).
 *
 * ## Why a refusal, and not a fold or a lowering
 *
 * - There is nothing to LOWER it to. `@objectstack/spec` ruled
 *   `{ field: {} }` REJECTED (objectstack#5240, recorded on
 *   `FilterConditionSchema`) in every position, so the request above is one
 *   the platform refuses, and inventing a node for it would invent semantics.
 * - FOLDING it — dropping the key, which is what the beside-a-key case did —
 *   silently drops a filter the author wrote, and "no constraint on this
 *   field" widens the result on a slot whose purpose can be to hide rows.
 * - A refusal is what this function already answers for the bare-array and the
 *   exotic-comparand arms, for the same reason: the author learned nothing at
 *   lowering time.
 *
 * ## Where — the operator-map arm, not the tail
 *
 * It is refused where it is met, in the loop, like the two comparand arms.
 * objectui#9164 judged it in the tail and so reached it only when nothing else
 * produced a condition; beside a key that lowers the tail is never entered,
 * which is exactly the case objectui#10788 closes. One throw site serves both,
 * so the alone case is not refused twice over and cannot drift from the
 * beside case. A `$and` / `$or` member is converted by this same function, so
 * a member that is or carries an empty operator map is refused too, once
 * `lowerLogicalGroup` converts it (a TRUE disjunct earlier in an `$or` still
 * returns first; objectui#10789).
 *
 * `field` is the only handle, so it travels as the refusal's subject and no
 * `operator` is set: the author wrote none, and naming one would send them
 * looking for a key their filter does not contain.
 */
function refuseEmptyOperatorMap(field: string): never {
  throw new FilterOperatorError(
    `[ObjectUI] The filter on field '${field}' is an EMPTY operator map — ` +
    `{ ${field}: {} } names the field and no operator. It cannot be lowered: the ` +
    `ObjectQL filter AST has no node for a field with zero operators, and ` +
    `'@objectstack/spec' ruled the shape REJECTED wherever it appears ` +
    `(objectstack#5240, recorded on FilterConditionSchema). It is refused here ` +
    `rather than dropped: beside a key that lowers, the '${field}' condition used ` +
    `to vanish from the filter and silently WIDEN the result set (objectui#10788), ` +
    `and alone it was handed back as the caller's object, which reached the wire ` +
    `as ?${field}=[object Object] on one route and as a filter the server refuses ` +
    `on the other (objectui#9164). Choose an operator — ` +
    `{ ${field}: { $eq: ... } }, { ${field}: { $in: [...] } }, ` +
    `{ ${field}: { $null: true } } — or remove the key.`,
    { field },
  );
}

/**
 * Convert object-based filters to ObjectStack FilterNode AST format.
 * Converts MongoDB-like operators to ObjectStack filter expressions.
 * 
 * @param filter - Object-based filter with optional operators
 * @returns FilterNode AST array
 * 
 * @example
 * // Simple filter - converted to AST
 * convertFiltersToAST({ status: 'active' })
 * // => ['status', '=', 'active']
 * 
 * @example
 * // Complex filter with operators
 * convertFiltersToAST({ age: { $gte: 18 } })
 * // => ['age', '>=', 18]
 * 
 * @example
 * // Multiple conditions
 * convertFiltersToAST({ age: { $gte: 18, $lte: 65 }, status: 'active' })
 * // => ['and', ['age', '>=', 18], ['age', '<=', 65], ['status', '=', 'active']]
 *
 * @example
 * // Logical combinators (objectui#6948) — children lower recursively
 * convertFiltersToAST({ $or: [{ status: 'open' }, { status: 'blocked' }] })
 * // => ['or', ['status', '=', 'open'], ['status', '=', 'blocked']]
 *
 * @example
 * // A Date is a comparand, not an operator map (objectui#8555). It lowers as
 * // the Date INSTANCE — the spec accepts one, and the operator form already
 * // emits one.
 * convertFiltersToAST({ created: new Date('2026-01-01') })
 * // => ['created', '=', Date(2026-01-01)]
 *
 * @throws {FilterOperatorError} If an unknown operator is encountered, if
 * `$not` is used — see the `$not` arm for why the AST cannot carry it — if a
 * field's value is a bare ARRAY (`{ tags: ['a', 'b'] }`) — see the array arm for
 * why that is refused rather than read as `$in` — or if a field's value is an
 * EXOTIC object the spec does not accept as a comparand (`{ name: /abc/ }`,
 * a `Set`, a `Map`): see the exotic-comparand arm for why that is refused
 * rather than dropped (objectui#8567), or if an `$icontains` comparand is not a
 * NON-EMPTY STRING (`{ name: { $icontains: '' } }`, `{ name: { $icontains: 42 } }`)
 * — two shapes `@objectstack/spec`'s `FILTER_TEXT_CASES` declares REFUSED and
 * `ValueDataSource` has refused since objectui#8748; see
 * {@link refuseTextComparand} (objectui#9001), or if a field is an EMPTY
 * operator map (`{ a: {} }`) — alone (objectui#9164) or
 * beside a key that lowers (objectui#10788): see {@link refuseEmptyOperatorMap},
 * or if a `$empty` flag is not a boolean (`{ a: { $empty: 'yes' } }`,
 * objectui#11094).
 *
 * @example
 * // A field with NO operator (objectui#9164)
 * convertFiltersToAST({ a: {} })
 * // => throws FilterOperatorError (INVALID_FILTER / 400), field 'a'
 *
 * @example
 * // … and beside a key that lowers, where it used to vanish and widen the
 * // result to `['status', '=', 'a']` (objectui#10788)
 * convertFiltersToAST({ status: 'a', created: {} })
 * // => throws FilterOperatorError (INVALID_FILTER / 400), field 'created'
 *
 * @example
 * // A filter that is NOTHING BUT combinators reducing to the TRUE identity
 * // constrains nothing, and says so (objectui#8770). Callers skip the slot.
 * convertFiltersToAST({ $and: [] })
 * // => undefined
 *
 * @example
 * // A filter whose EVERY key is skipped for a null/undefined value also
 * // constrains nothing — the same answer this function already gives that key
 * // when a sibling survives (objectui#9020). Callers skip the slot.
 * convertFiltersToAST({ a: null })
 * // => undefined
 *
 * @example
 * // … and a filter that MIXES the two constrains nothing either, because the
 * // identity fold counts only the keys the loop actually PROCESSED
 * // (objectui#9030). A skipped key used to be counted against that fold, so a
 * // filter whose every key folds alone did not fold together.
 * convertFiltersToAST({ $and: [], b: undefined })
 * // => undefined
 */
export function convertFiltersToAST(
  filter: Record<string, any>,
): FilterNode | Record<string, any> | undefined {
  const conditions: FilterNode[] = [];
  /**
   * How many keys were a `$and` / `$or` group that reduced to the TRUE identity
   * — see the tail for why a COUNT rather than a flag.
   */
  let trueIdentityGroups = 0;
  /**
   * How many keys the loop SKIPPED for a `null` / `undefined` value — a SECOND
   * count, deliberately not folded into the one above. The tail says why the
   * two "this constrains nothing" states are counted apart even though they
   * reach the same answer (objectui#9020).
   */
  let skippedNullKeys = 0;

  for (const [field, value] of Object.entries(filter)) {
    if (value === null || value === undefined) {
      skippedNullKeys += 1;
      continue;
    }

    // Logical combinators are read BEFORE the field/operator machinery below,
    // because they are not fields and their value is not an operator map.
    // Without this arm `$and` / `$or` reached the simple-equality branch (their
    // value is an array, so the operator loop was skipped) and became a leaf
    // naming a field literally called `$and` / `$or`, while `$not` entered the
    // operator loop with its OWN nested object's keys read as operator names.
    const logicKeyword = AST_LOGIC_KEYWORD[field];
    if (logicKeyword) {
      const group = lowerLogicalGroup(field, logicKeyword, value);
      if (group !== undefined) conditions.push(group);
      else trueIdentityGroups += 1;
      continue;
    }

    if (field === '$not') {
      throw new FilterOperatorError(
        `[ObjectUI] The '$not' filter combinator cannot be lowered to the ObjectQL ` +
        `filter AST. '@objectstack/spec' declares it on FilterCondition, but the AST ` +
        `this layer emits has no negation keyword (FILTER_ARRAY_LOGIC_KEYWORDS is ` +
        `['and', 'or']), and rewriting the negation inward is not available either — ` +
        `'startswith', 'endswith', 'between' and 'icontains' have no negated ` +
        `counterpart in VALID_AST_OPERATORS, so the rewrite would be silently ` +
        `partial. Express the negation with a negated operator instead ($ne, $nin, ` +
        `$notContains); note those follow each operator's own answer for a missing ` +
        `value rather than $not's NULL-safe rule (objectstack#5146). ` +
        `Value: ${JSON.stringify(value)}.`,
        { operator: '$not' },
      );
    }

    // A bare ARRAY in comparand position is the third shape this file cannot
    // lower, after `$regex` and `$not` (objectui#8530). The equality `else`
    // below used to catch it and emit `[field, '=', [...]]` — an array in a
    // scalar-equality slot. The spec's own doors pass that node through
    // unjudged (`isFilterAST` is true and `parseFilterAST` hands back
    // `{ field: [...] }`; measured against @objectstack/spec 17.3.0, whose
    // `assertListComparandShapes` rules only on `$in` / `$nin` / `$between`),
    // so the refusal arrived two layers later: `@objectstack/driver-sql`
    // answers 400 INVALID_FILTER, and the in-memory matchers
    // (`@objectstack/formula`, `ValueDataSource` since objectui#8514) refuse
    // the node and exclude every row. Either way the author learned nothing at
    // lowering time. Refused HERE instead, where the field name and the
    // offending value are both still in hand.
    //
    // NOT lowered to `in`. `{ tags: ['a', 'b'] }` and `{ tags: { $in: ['a', 'b'] } }`
    // are different statements and the second is already spellable; rewriting
    // one into the other guesses at intent and silently changes which rows a
    // stored view returns — the lenient second contract objectui#8514 was
    // resolved against on this same data shape one layer down. A lowering to
    // `in` would be a deliberate, separately-argued change, not a fallback.
    //
    // `$in` / `$nin` / `$between` MEMBERS are legitimately arrays and are read
    // by the operator loop below, never here; `$and` / `$or` carry arrays of
    // conditions and were consumed by the combinator arm above.
    if (Array.isArray(value)) {
      throw new FilterOperatorError(
        `[ObjectUI] The filter on field '${field}' carries a bare ARRAY as its ` +
        `equality comparand: ${JSON.stringify(value)}. It cannot be lowered: the ` +
        `ObjectQL filter AST has no array-equality node, so the lowered node ` +
        `[${field}, '=', [...]] is refused by @objectstack/driver-sql (400 INVALID_FILTER) ` +
        `and matches no row in the in-memory matchers — it can never select anything. ` +
        `It is deliberately NOT read as membership here: { ${field}: [...] } and ` +
        `{ ${field}: { $in: [...] } } are different statements, and guessing the ` +
        `second from the first would silently change which rows a stored view ` +
        `returns (objectui#8530; the same ruling objectui#8514 applied one layer ` +
        `down). Spell membership as { ${field}: { $in: [...] } }, its negation as ` +
        `{ ${field}: { $nin: [...] } }, or a range as { ${field}: { $between: [min, max] } }.`,
        { field },
      );
    }

    // Check if value is a complex operator object
    if (typeof value === 'object' && !Array.isArray(value)) {
      // A `Date` is a COMPARAND, not an operator map — objectui#8555.
      //
      // `typeof new Date()` is `'object'` and a Date is not an array, so it used
      // to enter the loop below; `Object.entries(someDate)` is `[]`, the body
      // never ran, and NO condition was pushed for the field. Not refused, not
      // lowered wrongly — ABSENT, so `{ status: 'a', created: someDate }`
      // lowered to `['status', '=', 'a']` and the result set got WIDER than the
      // author asked for, silently. That is the one failure direction this file
      // exists to avoid. It also made the field's behaviour depend on its
      // SIBLINGS: a Date alone left `conditions` empty, so the original object
      // came back untouched and the defect was invisible until a second field
      // appeared.
      //
      // Lowered rather than refused, and the spec is what decides it — the
      // opposite answer to objectui#8514, which was a refusal precisely because
      // the spec DECLINED to rule on that shape. Here it rules, twice over
      // (measured against @objectstack/spec 17.3.0):
      // `ACCEPTED_FILTER_COMPARAND_TYPES` is
      // `['string','number','bigint','boolean','null','Date']`, and
      // `$gt`/`$gte`/`$lt`/`$lte`/`$between` declare `z.ZodDate` in comparand
      // position. So a Date is a first-class filter comparand, not a shape this
      // layer has to invent an answer for.
      //
      // ⛔ NOT converted to an ISO string or an epoch here. The wire form is not
      // this adapter's question to answer: `parseFilterAST(['created', '=', d])`
      // hands back `{ created: d }` with the Date INSTANCE intact (measured), and
      // `normalizeFilterComparandTypes` accepts it as-is. The operator arm below
      // already passes a Date through untouched (`{ created: { $gte: d } }` →
      // `['created', '>=', d]`), so stringifying here would make the shorthand
      // and the operator form emit two different comparand types for the same
      // author intent — a second dialect, in the file whose whole job is to have
      // one.
      //
      // The gate is the spec's own predicate rather than a local `instanceof
      // Date`, the same reason `normalizeFilterOperator` is used below instead of
      // a second operator map. Today `Date` is its only object-typed member
      // (pinned in filter-date-comparand-8555.test.ts), so this arm is a Date arm
      // in practice; if the spec ever accepts another object-shaped literal, this
      // reads it as a comparand instead of silently dropping it.
      if (isAcceptedFilterComparand(value)) {
        conditions.push([field, '=', value]);
        continue;
      }

      // An EXOTIC object in comparand position — objectui#8567, the other half
      // of the hole objectui#8555 closed.
      //
      // Same silent failure, one door further along: `Object.entries(/abc/)`,
      // `Object.entries(new Set(['x']))` and `Object.entries(new Map())` are all
      // `[]` (measured), so the loop below ran zero times and pushed NO condition
      // for the field. `{ status: 'a', created: /abc/ }` lowered to
      // `['status', '=', 'a']` — WIDER than the author asked for, with nothing
      // thrown and nothing logged. With the exotic value alone `conditions` ended
      // empty and the original object came back untouched, so the defect needed a
      // sibling field to become visible at all.
      //
      // REFUSED rather than lowered, and — unlike the arm above — the spec rules
      // it OUT rather than IN (measured against @objectstack/spec 17.3.0, floor
      // ^17.2.0): `isAcceptedFilterComparand(/x/)` is `false`, and
      // `normalizeFilterComparandTypes({ created: /x/ })` answers `INVALID_FILTER`
      // / 400 — "Filter comparand at where.created is a RegExp instance ({}),
      // which no driver can compare." Lowering it would only move that refusal
      // downstream; dropping it is the defect. So the answer the wire would give
      // two layers later is given HERE, where the field name and the offending
      // value are both still in hand.
      //
      // ⚠️ This is NOT the class the `$regex` and `$not` refusals below belong
      // to, and their message idiom is deliberately not copied. Those two answer
      // "this layer has no TARGET for your operator" — `$regex` is absent from
      // the spec's `FILTER_OPERATORS`, and `$not` is declared by the spec but has
      // no keyword in the AST dialect this file emits. This one answers a
      // question about a VALUE: the spec's own comparand-type predicate rejects
      // it. The nearest neighbour is the bare-array arm above, which is also
      // about a comparand — but that refusal rests on the spec DECLINING to rule
      // (`assertListComparandShapes` rules only on `$in` / `$nin` / `$between`),
      // which is the opposite authority to this one. What IS shared is the error
      // TYPE: `FilterOperatorError` is named for operators but already carries
      // four non-operator refusals in this file, because what it actually
      // transports is the `INVALID_FILTER` / 400 envelope `classifyLoadError`
      // reads — see its declaration.
      //
      // The accepted-type list is the spec's own sentence, not a second list
      // spelled out here, for the same reason the gate above is the spec's
      // predicate rather than a local `instanceof Date`.
      if (!isOperatorMap(value)) {
        throw new FilterOperatorError(
          `[ObjectUI] The filter on field '${field}' carries ${describeExoticComparand(value)} ` +
          `in comparand position. '@objectstack/spec' does not accept it: a comparison value must ` +
          `be ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} (ACCEPTED_FILTER_COMPARAND_TYPES), so ` +
          `isAcceptedFilterComparand is false for it and normalizeFilterComparandTypes answers 400 ` +
          `INVALID_FILTER — "which no driver can compare". It is not an operator map either: only ` +
          `a plain object can be one, so until objectui#8567 this value was read as ZERO operators ` +
          `and the '${field}' condition was dropped from the filter entirely, silently WIDENING the ` +
          `result set. Spell a text match as { ${field}: { $contains: '...' } } ($startsWith / ` +
          `$endsWith; a pattern itself has no operator here, see the $regex refusal), a membership ` +
          `test as { ${field}: { $in: [...] } }, and a date bound as ` +
          `{ ${field}: { $gte: new Date(...) } }.`,
          { field },
        );
      }

      // An operator map with NO operators — `{ created: {} }` — would push
      // nothing below. It is refused HERE, where it is met, and not in the
      // tail: beside a key that lowers, the tail is never reached, and the key
      // used to vanish from the filter (objectui#10788). Alone, it is refused
      // by this same line (objectui#9164). See refuseEmptyOperatorMap.
      const operatorEntries = Object.entries(value);
      if (operatorEntries.length === 0) refuseEmptyOperatorMap(field);

      // Handle operator-based filters
      for (const [operator, operatorValue] of operatorEntries) {
        // `$regex` is refused, not downgraded. It used to become `contains`
        // behind a `console.warn` — but substring matching is a DIFFERENT
        // QUESTION, not a weaker version of the same one: `$regex: 'a.c'`
        // matches "abc", `contains 'a.c'` does not, and neither result looks
        // wrong on screen. A warning is not an error channel; nobody reads the
        // console of a deployed app.
        //
        // The spec has no `$regex` (`FILTER_OPERATORS`, data/filter.zod.ts), so
        // there is nothing to translate it INTO. Same treatment the unknown
        // operator below already gets, and for the same stated reason.
        if (operator === '$regex') {
          throw new FilterOperatorError(
            `[ObjectUI] The '$regex' filter operator is not supported. It used to be ` +
            `converted to 'contains', which matches a literal substring rather than a ` +
            `pattern — a different result, not a degraded one. ` +
            `Field: '${field}', Value: ${JSON.stringify(operatorValue)}. ` +
            `Use $contains for a case-sensitive substring, $icontains for a ` +
            `case-insensitive one, or $startsWith / $endsWith.`,
            { operator: '$regex', field },
          );
        }

        // $null / $exists translate based on their boolean value (per spec semantics).
        // $null: true  → IS NULL    | $null: false  → IS NOT NULL
        // $exists: true → IS NOT NULL | $exists: false → IS NULL
        if (operator === '$null') {
          conditions.push([field, operatorValue ? 'is_null' : 'is_not_null', true]);
          continue;
        }
        if (operator === '$exists') {
          conditions.push([field, operatorValue ? 'is_not_null' : 'is_null', true]);
          continue;
        }
        // objectui#11094 — `$empty`, admitted to the spec's `FILTER_OPERATORS`
        // in `@objectstack/spec` 17.6.0 (objectstack#20446). The spec's own
        // `parseFilterAST` reads `is_empty` as `$empty: true` and `is_not_empty`
        // as `$empty: false`, so this is the inverse of that lowering, written
        // the way `$null` is written above: direction from the flag, a `true`
        // placeholder in the value slot, which the spec discards.
        //
        // The flag is a BOOLEAN by declaration (`SpecialOperatorSchema`), so a
        // non-boolean is refused rather than read for its truthiness. That is
        // the answer the spec's save door and every query face give, and
        // `ValueDataSource`'s `$empty` arm refuses the same values, so one
        // authored filter gets one answer whichever data source is behind it.
        // Until this arm the operator reached the unknown-operator throw below.
        if (operator === '$empty') {
          if (operatorValue !== true && operatorValue !== false) {
            throw new FilterOperatorError(
              `[ObjectUI] The '$empty' filter operator on field '${field}' takes a boolean flag ` +
              `(true or false); received ${JSON.stringify(operatorValue) ?? String(operatorValue)}. ` +
              `Write { ${field}: { $empty: true } } for an empty value, or ` +
              `{ ${field}: { $empty: false } } for a non-empty one.`,
              { operator: '$empty', field },
            );
          }
          conditions.push([field, operatorValue ? 'is_empty' : 'is_not_empty', true]);
          continue;
        }

        const astOperator = convertOperatorToAST(operator);
        
        if (astOperator) {
          // objectui#9001 — the comparand door, at the ONE place this function
          // reads a comparand. It runs before the push, so the refused node is
          // never built; there is no `continue` and no key is skipped, which is
          // what keeps the TRUE-identity tail's key-count comparison
          // (objectui#8770, and the denominator objectui#9030 narrowed to the
          // keys the loop processes) reading exactly what it read before.
          //
          // Keyed on the LOWERED operator rather than on the `$` spelling: the
          // rule belongs to `icontains` itself, and `ValueDataSource`'s AST arm
          // is keyed the same way. The `$` spelling the AUTHOR wrote is what
          // travels into the message, which is what `FILTER_TEXT_CASES`'
          // `mustMention: ['$icontains']` is about.
          if (astOperator === 'icontains' && isRefusedTextComparand(operatorValue)) {
            refuseTextComparand(field, operator, operatorValue);
          }
          conditions.push([field, astOperator, operatorValue]);
        } else {
          // A RETIRED lowercase alias is answered by name, before the generic
          // arm below can swallow it into "unknown operator" (objectui#8568).
          const canonical = RETIRED_OPERATOR_ALIASES[operator];
          if (canonical) {
            throw new FilterOperatorError(
              `[ObjectUI] The '${operator}' filter operator is retired. Write ` +
              `'${canonical}' instead — the canonical spelling '@objectstack/spec' declares ` +
              `in FILTER_OPERATORS (data/filter.zod.ts). The operator itself is unchanged; ` +
              `only the key is renamed. Field: '${field}', Value: ${JSON.stringify(operatorValue)}. ` +
              `It used to be accepted here as a lowercase alias while the in-memory matcher ` +
              `refused it, so the same filter selected rows through one data source and none ` +
              `through the other (objectui#8568).`,
              { operator, field },
            );
          }
          // Unknown operator - throw error to avoid silent failure
          throw new FilterOperatorError(
            `[ObjectUI] Unknown filter operator '${operator}' for field '${field}'. ` +
            `Supported operators: $eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $between, ` +
            `$contains, $notContains, $startsWith, $endsWith, $icontains, $null, $exists, $empty. ` +
            `If you need exact object matching, use the value directly without an operator.`,
            { operator, field },
          );
        }
      }
    } else {
      // Simple equality filter
      conditions.push([field, '=', value]);
    }
  }
  
  if (conditions.length === 0) {
    // The WHOLE filter was combinators that reduced to the TRUE identity —
    // objectui#8770.
    //
    // `lowerLogicalGroup` answers `undefined` for a group that constrains
    // nothing (`{ $and: [] }`, `{ $and: [{}] }`, `{ $or: [{}] }` — the
    // identities objectstack#5322 rules TRUE), deliberately, so that no
    // childless `['and']` is emitted. When such a group was the only thing in
    // the filter that `undefined` reached the tail below, and the CALLER'S
    // ORIGINAL OBJECT came back in its place — so the group did not disappear
    // at this level after all. It reappeared one level up, in the `$` dialect,
    // in a slot the AST is expected to occupy.
    //
    // What that cost, measured against @objectstack/spec 17.4.0 and
    // @objectstack/client 17.4.0 rather than assumed: the object is NOT handed
    // to the wire as a filter and refused there. `client.data.find()` tests the
    // value with `isFilterAST`, and its ELSE branch spreads a plain object's
    // entries as query parameters — so `{ $and: [] }` left as `?$and=` and
    // `{ $or: [{}] }` as `?$or=[object Object]`, with no `filter` parameter at
    // all, and the server refused the unknown `$`-prefixed parameter with `400
    // UNSUPPORTED_QUERY_PARAM`. A filter whose ruled answer is EVERY ROW was a
    // failed list. (The `$expand` / `$search` route sends the same object as
    // `filter={"$and":[]}`, which the server accepts as a `FilterCondition` and
    // answers with every row — so the two routes disagreed about one filter,
    // and the fix makes both say what the ruling says.)
    //
    // `undefined` is not a new vocabulary invented here. It is already what
    // `toFilterNode`, `mergeFilterNodes` and data-objectstack's
    // `translateFilterToAST` mean by "no filter, skip the slot", and every call
    // site of this function already acts on it: `lowerLogicalGroup` above tests
    // `Array.isArray`, the other three test for `undefined` or falsiness.
    //
    // ⛔ Scoped to a filter whose every PROCESSED key is such a group, which is
    // why the count above is compared with a count instead of being a flag.
    // Inputs that are not combinators at all are NOT this case: `{}` still
    // reaches the `return filter` below, and an empty operator map never gets
    // this far — the operator-map arm refuses it where it is met
    // (objectui#9164, objectui#10788).
    //
    // ⭐ The denominator is the number of keys the LOOP ACTUALLY PROCESSED, not
    // `Object.keys(filter).length` — objectui#9030. Those differ by exactly the
    // keys the loop's own first statement skipped, and counting a skipped key
    // against this fold made the fold's answer depend on a key that, by this
    // function's oldest ruling, contributes nothing: `{ $and: [] }` folded and
    // `{ $and: [], b: undefined }` did not, though `JSON.stringify` drops the
    // second key entirely and the two reach either wire route as the same
    // bytes. Both `null` and `undefined` are subtracted, because the loop skips
    // them with one statement and the guard below already gives that whole
    // class the same `undefined` when it is alone — leaving the MIXTURE out
    // would mean adding an always-TRUE `$and: []` to a filter that folds could
    // stop it folding, which is the sibling-dependence hazard objectui#8555
    // named on this file.
    //
    // ⚠ Subtraction, not a merged counter. `trueIdentityGroups > 0` still
    // gates this arm and the skipped count still has its own arm below, so the
    // two states stay told apart — what changed is only which keys this one
    // is measured against.
    const keysTheLoopProcessed = Object.keys(filter).length - skippedNullKeys;
    if (trueIdentityGroups > 0 && trueIdentityGroups === keysTheLoopProcessed) {
      return undefined;
    }

    // The WHOLE filter was keys the loop SKIPPED for a null/undefined value —
    // objectui#9020.
    //
    // Skipping such a key is this file's oldest documented behaviour and is NOT
    // what changed here: `{ a: null, s: 1 }` still lowers to `['s', '=', 1]`,
    // pinned as "should skip null and undefined values" since long before any of
    // the cards above. What changed is what the function says when the skip
    // leaves NOTHING behind. It used to hand back the CALLER'S ORIGINAL OBJECT,
    // and that object meant two different things on the two `find()` routes of
    // `@object-ui/data-objectstack` — measured against @objectstack/spec 17.4.0
    // and @objectstack/client 17.4.0:
    //
    //   - the plain route (`convertQueryParams` → `client.data.find`) tests the
    //     value with `isFilterAST`, and its ELSE branch spreads a plain object's
    //     entries as query parameters SKIPPING null ones — so `{ a: null }`
    //     appended nothing at all, no `filter` parameter was sent, and the
    //     answer was EVERY ROW;
    //   - the `$expand` / `$search` route (`rawFindWithPopulate`, and the export
    //     route beside it) JSON-serialises the same object into `filter=`, and
    //     `{ a: null }` is a well-formed `FilterCondition` the spec accepts
    //     (`null` is in `ACCEPTED_FILTER_COMPARAND_TYPES`), so it arrived as a
    //     REAL predicate and the answer was SOME rows.
    //
    // One authored filter, two row sets, and the deciding input was whether the
    // query happened to want a lookup expanded — the split objectui#6948
    // recorded on this file and the shared `translateFilterToAST` helper exists
    // to close. It was also self-inconsistent within ONE route: the key meant
    // "no constraint" the moment ANY sibling produced a condition and meant a
    // predicate when it was alone, which is the sibling-dependence objectui#8555
    // named here.
    //
    // ⇒ the tie is broken by what this function ALREADY says about the key, not
    // by inventing a meaning for it. The loop's `continue` is the ruling: the key
    // contributes no condition. Carrying that to the wire is `undefined`, and an
    // author who wants the predicate has always been able to spell it
    // `{ a: { $null: true } }` → `['a', 'is_null', true]`. The opposite repair —
    // making a null-valued key lower to a predicate — would have broken the skip
    // pin and changed every caller.
    //
    // ⚠️ SAME ANSWER as the fold above, NOT the same state, which is why these
    // are two counts and two guards rather than one. That fold's `undefined` is
    // objectstack#5322's RULED identity, reached by `lowerLogicalGroup`; this
    // one is this file's own tolerance made consistent with itself. They
    // coincide because "no constraint" has exactly ONE expressible spelling in
    // this dialect — the absence of the slot — not because the two inputs are
    // the same kind of thing.
    //
    // A filter that MIXES the two kinds (`{ $and: [], a: null }`,
    // `{ $and: [], b: undefined }`) is answered by the fold ABOVE, since
    // subtracting the skipped keys leaves a filter whose every processed key is
    // an identity group — objectui#9030. It used to satisfy neither guard and
    // come back as the object, so a filter each of whose keys folds ALONE did
    // not fold TOGETHER. That is why the counts staying apart is a statement
    // about the two STATES and never about the two ARMS being unreachable from
    // one input.
    //
    // ⛔ `{}` is not this case either — `skippedNullKeys > 0` excludes it. An
    // empty filter has no key to skip, `toFilterNode` already folds it one level
    // up, and objectui#8770 measured that boundary; moving it is a separate
    // argument nobody has made.
    if (skippedNullKeys > 0 && skippedNullKeys === Object.keys(filter).length) {
      return undefined;
    }

    // Only `{}` — a filter with no key at all — still comes back as itself.
    // Every other way to reach this tail is answered above, and an empty
    // operator map (`{ a: {} }`, `{ a: {}, b: undefined }`,
    // `{ $and: [], a: {} }`) never reaches it: the operator-map arm refuses it
    // where it is met (objectui#9164, objectui#10788). `toFilterNode` folds
    // `{}` one level up, and objectui#8770 measured that boundary.
    return filter;
  }
  
  // If only one condition, return it directly
  if (conditions.length === 1) {
    return conditions[0];
  }
  
  // Multiple conditions: combine with 'and'
  return ['and', ...conditions];
}

/**
 * A spec `ViewFilterRule` as it arrives from stored view metadata.
 *
 * Structurally recognisable and NOT guessed at: every AST node is an ARRAY, a
 * rule is a plain OBJECT. The two can never be confused, so this predicate is
 * exact rather than heuristic.
 *
 * A blank `field` is deliberately NOT a rule — same predicate the write side
 * uses to drop the row `Add filter` inserts before a column is picked. Lowering
 * it would produce `['', op, value]`, which `isFilterAST` ACCEPTS and the
 * server answers `200` with zero rows (measured) — a silently-empty list. Left
 * unlowered it stays an object in AST position, which the server refuses with
 * `400 INVALID_FILTER` naming the element. Loud beats silently-empty.
 */
interface ViewFilterRuleLike {
  field: string;
  operator?: unknown;
  value?: unknown;
}

function isViewFilterRule(value: unknown): value is ViewFilterRuleLike {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const field = (value as { field?: unknown }).field;
  return typeof field === 'string' && field !== '';
}

/**
 * Lower ONE spec `ViewFilterRule` to an ObjectQL AST comparison node.
 *
 * The operator goes through the spec's OWN {@link normalizeFilterOperator} —
 * the exact exit the WRITE side uses (`app-shell/views/viewFilterFold.ts`), so
 * the two directions cannot drift into two dialects. No second canonical map is
 * introduced, and none is needed: all 19 `VIEW_FILTER_OPERATORS` are already
 * members of the wire's `VALID_AST_OPERATORS`, so the lowering is purely
 * structural. An operator the spec does not know is passed through VERBATIM, so
 * `isFilterAST` still refuses it and the server still answers `400
 * INVALID_FILTER` — a misspelling must not be coerced into a valid one.
 *
 * `value` is emitted only when the rule carries one. A rule that omits it
 * (`is_empty` / `is_null`, whose direction comes from the operator NAME) would
 * otherwise gain an invented `null` the author never wrote — `JSON.stringify`
 * turns a hole in an array into `null`, and `['x', 'equals', null]` is a real
 * `{x: null}` predicate, i.e. a silently-wrong filter. Same rule the write side
 * applies (`if (c.value !== undefined)`).
 *
 * The value's SHAPE is checked too, against the operator's arity — an array on a
 * single-value operator is refused rather than passed through. See the arm
 * itself for the reasoning and for why the refusal is a throw (objectui#8557).
 *
 * Its COMPARAND is checked on one operator, `icontains`, whose two refused
 * shapes `@objectstack/spec`'s `FILTER_TEXT_CASES` declares (objectui#9048).
 * That arm reads the same shared refusal `convertFiltersToAST` and
 * `ValueDataSource` read, and the arm itself carries the weighing for a SAVED
 * view — which is a different input from objectui#8557's and was redone rather
 * than inherited.
 *
 * @throws {FilterOperatorError} If the rule carries an ARRAY on an operator the
 * spec declares single-valued, or an empty / non-string comparand on
 * `icontains`.
 */
/**
 * The view-filter operators whose `value` is legitimately an ARRAY.
 *
 * Not a local list — both halves are the spec's own, and it exports them for
 * exactly this question: `VIEW_FILTER_LIST_VALUE_OPERATORS` (`['in', 'not_in']`)
 * says which operators take a membership list, `VIEW_FILTER_PAIR_VALUE_OPERATORS`
 * (`['between']`) which take a `[min, max]` pair, and the docblock on the first
 * of them names a hard-coded `["in", "notIn"]` elsewhere in this repo as the
 * mistake it exists to prevent (`notIn` is an alias, not the canonical member).
 * Same reason the operator itself goes through `normalizeFilterOperator` rather
 * than a second map.
 */
const ARRAY_VALUED_VIEW_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...VIEW_FILTER_LIST_VALUE_OPERATORS,
  ...VIEW_FILTER_PAIR_VALUE_OPERATORS,
]);

/**
 * The view-filter operators that carry NO comparand — their direction comes from
 * the operator NAME.
 *
 * The spec exports the two array-valued sets but no set for these, so this is
 * the one classification written out here. It is pinned against
 * `VIEW_FILTER_OPERATORS` (filter-view-rule-arity-8557.test.ts) so the four sets
 * partition the vocabulary exactly: an operator added to the spec lands in no
 * class, the pin reddens, and someone classifies it rather than it silently
 * inheriting a verdict.
 *
 * They are excluded from the refusal below deliberately, and on a measurement:
 * the spec DISCARDS a value on these operators — `parseFilterAST(['tags',
 * 'is_null', ['a']])` is `{ tags: { $null: true } }` — so a stray array here
 * cannot produce a node that selects the wrong rows. Refusing it would turn a
 * harmless input into a render-time throw, and the message would prescribe `in`
 * for an operator that takes no value at all.
 */
const VALUELESS_VIEW_OPERATORS: ReadonlySet<string> = new Set<string>([
  'is_empty',
  'is_not_empty',
  'is_null',
  'is_not_null',
]);

/** Every operator spelling the spec knows, canonical forms only. */
const KNOWN_VIEW_OPERATORS: ReadonlySet<string> = new Set<string>(VIEW_FILTER_OPERATORS);

function viewFilterRuleToNode(rule: ViewFilterRuleLike): FilterNode {
  const operator = normalizeFilterOperator(rule.operator as string);

  // An ARRAY on an operator that takes ONE value is refused here — objectui#8557.
  //
  // `rule.value` used to travel through unread, so a stored view rule
  // `{ field: 'tags', operator: 'equals', value: ['a'] }` became
  // `['tags', 'equals', ['a']]`. Measured against @objectstack/spec 17.3.0, the
  // spec's doors pass that node through unjudged — `isFilterAST` is `true` and
  // `parseFilterAST` hands back `{ tags: ['a'] }` — which is the SAME
  // array-in-a-scalar-slot shape the object arm above refuses (objectui#8530):
  // the ObjectQL AST has no array-equality node, `@objectstack/driver-sql`
  // answers `400 INVALID_FILTER`, and every in-memory matcher excludes every
  // row. So a hand-authored `{ tags: ['a'] }` already failed fast with a message
  // naming `$in`, while the same mistake SAVED INTO A VIEW still travelled
  // silently to a 400 the author could not attribute to their filter. This
  // closes that asymmetry.
  //
  // Keyed on the operator's ARITY, never on `Array.isArray(value)` alone:
  // `in` / `not_in` / `between` rules legitimately carry arrays through this
  // very function, and that path had no pin protecting it until this card.
  // The check runs AFTER normalization so an alias is judged by what it means —
  // `nin` is `not_in`, and is array-valued.
  //
  // An operator the spec does NOT know is left alone. `normalizeFilterOperator`
  // passes a misspelling through verbatim precisely so `isFilterAST` refuses it
  // and the server names it; refusing it HERE would report the wrong problem
  // ("use $in") for what is actually a typo.
  //
  // ## Why the refusal is a THROW, and why it belongs here
  //
  // It throws from the lowering, which for a saved view means the view fails at
  // render rather than returning a narrower answer. That is a real blast radius
  // and it was weighed:
  //
  //   - It is not a NEW blast radius. Both sinks already catch a
  //     `FilterOperatorError` from this same file — `plugin-list`'s
  //     `buildEffectiveFilter` runs inside `ListView`'s load `try` and lands in
  //     `setLoadError`, `plugin-view`'s `ObjectView` calls `mergeFilterNodes`
  //     inside its own load `try` — because the object arm has thrown for
  //     `$regex`, `$not` and bare arrays since objectui#8530. `classifyLoadError`
  //     reads this error's `INVALID_FILTER` / `400`, so what a user sees is the
  //     "filter is malformed" panel, not a crashed page and not a network error.
  //   - The alternatives are both silent. DROPPING the rule widens the result
  //     set, the one direction this file exists to avoid — and a stored view's
  //     whole purpose can be to hide rows. Rewriting `equals` into `in` changes
  //     the author's meaning, the lenient second contract objectui#8514 was
  //     resolved against on this same data shape.
  //   - The rule was authored long ago by someone who is not present, which
  //     argues for the LOUDER answer, not the quieter one: a silent 400 two
  //     layers away is attributable to nothing, whereas this names the view's
  //     field and operator at the moment the filter is built.
  if (
    Array.isArray(rule.value)
    && typeof operator === 'string'
    && KNOWN_VIEW_OPERATORS.has(operator)
    && !ARRAY_VALUED_VIEW_OPERATORS.has(operator)
    && !VALUELESS_VIEW_OPERATORS.has(operator)
  ) {
    throw new FilterOperatorError(
      `[ObjectUI] The stored view rule on field '${rule.field}' carries an ARRAY ` +
      `as the comparand of '${operator}', which takes a single value: ` +
      `${JSON.stringify(rule.value)}. It cannot be lowered: the ObjectQL filter ` +
      `AST has no array-equality node, so the lowered node ` +
      `[${rule.field}, '${operator}', [...]] is refused by @objectstack/driver-sql ` +
      `(400 INVALID_FILTER) and matches no row in the in-memory matchers — it can ` +
      `never select anything. It is deliberately NOT rewritten to 'in': that ` +
      `would change what the saved view means, and 'in' is already spellable in ` +
      `the rule itself. Spell membership as ` +
      `{ field: '${rule.field}', operator: 'in', value: [...] }, its negation as ` +
      `'not_in', or a range as { operator: 'between', value: [min, max] } — the ` +
      `three operators the spec declares array-valued, which are untouched ` +
      `(objectui#8557; the same ruling objectui#8530 applied to the object arm).`,
      { operator, field: rule.field },
    );
  }

  // The `icontains` COMPARAND door, on the STORED VIEW rule vocabulary —
  // objectui#9048. Same two shapes `FILTER_TEXT_CASES` declares refused, same
  // discrimination and same words as `convertFiltersToAST` and
  // `ValueDataSource`, because all three now read ONE implementation
  // (`text-comparand.ts`) rather than three copies of it. Triage ruled exactly
  // that: "three implementations of one refusal, of which one is correct ⇒ the
  // useful dispatch is not 'add a third guard' but 'make the dialects share the
  // one that works'".
  //
  // ## Placed AFTER the arity arm, deliberately
  //
  // An ARRAY comparand on `icontains` is refused by objectui#8557 above, with
  // its message about `in` / `not_in` / `between`. Running this door first would
  // answer the same input with "not a string" — a true sentence that prescribes
  // the wrong repair, and a silent change to a shipped ruling this card is
  // fenced away from.
  //
  // ## An ABSENT comparand is left alone, and that is a boundary not an omission
  //
  // `isRefusedTextComparand(undefined)` is true, so the `!== undefined` test is
  // load-bearing. The `$` dialect has no "absent" — `{ $icontains: undefined }`
  // still HAS the key — but this vocabulary does, and the tail below already
  // encodes it: a rule with no `value` lowers to the 2-tuple `[field, operator]`
  // because the valueless operators (`is_null` and friends) take their direction
  // from the operator NAME. Measured on today's tree, that 2-tuple is already
  // refused downstream with THIS card's code: `parseFilterAST(['name',
  // 'icontains'])` throws `INVALID_FILTER` / 400 naming
  // `where.name.$icontains`. So the shape is loud already; moving WHERE it is
  // refused is a separate argument nobody has made, and `FILTER_TEXT_CASES`
  // declares two rows, not three.
  //
  // ## Why a THROW here, when it means a saved view fails at RENDER
  //
  // This is objectui#8557's weighing done again on a different input, not
  // inherited from it — the card says so, and the inputs really do differ.
  // Measured on `origin/main` `6df26f025` with `@objectstack/spec` 17.4.0, one
  // authored view rule `{ field: 'name', operator: 'icontains', value: '' }`:
  //
  //   - it lowers to `['name','icontains','']`, which `isFilterAST` ACCEPTS, so
  //     it is sent rather than stopped at any door;
  //   - `parseFilterAST` reads it as `{ name: { $icontains: '' } }`;
  //   - against the in-memory matchers that condition selects ZERO of the
  //     spec's own nine `FILTER_TEXT_ROWS` (`@objectstack/formula`'s
  //     `matchesFilterCondition`, and `ValueDataSource` since objectui#8748,
  //     which also prints a refusal);
  //   - and on the wire the published table states the other answer in its own
  //     words — "Every row contains the empty substring, so evaluating it is a
  //     predicate that constrains nothing".
  //
  // So the pre-fix answer is not one behaviour but TWO, chosen by which data
  // source the saved view happens to render against: silently-empty on the
  // in-memory faces, constrains-nothing on the wire. That is the acceptance-set
  // split this card family exists to close, and neither half is "a view that
  // renders correctly today". objectui#8557's conclusion (loud beats
  // silently-empty) covers the first half unchanged; the second half is the
  // WIDENING direction this file's own arity arm names as the one it exists to
  // avoid — "a stored view's whole purpose can be to hide rows". Both halves
  // point the same way, which is why the weighing survives the different input.
  //
  // The blast radius is also smaller than the shape suggests, measured rather
  // than assumed. The Console cannot author this rule: `foldFilterGroupToSpecRules`
  // (`@object-ui/app-shell`, objectui#4155) DROPS a condition whose value is
  // `null` / `''` / `[]` before it is persisted, precisely so an incomplete row
  // never reaches storage. And nothing in this tree authors the shape: over
  // every tracked file, an `operator: 'icontains'` rule appears only in this
  // card's own test, changeset and comment — lit control, 40 tracked files
  // mention the operator at all.
  //
  // ## ⚠️ Where the throw LANDS is a second question, and it is NOT settled here
  //
  // Two of the sinks catch it: `plugin-list`'s `buildEffectiveFilter` runs
  // inside `ListView`'s load `try` and `plugin-view`'s `ObjectView` inside its
  // own, and `classifyLoadError` reads this error's `INVALID_FILTER` / `400`, so
  // there the user sees the "filter is malformed" panel naming their field and
  // operator. FOUR more entries do not: `plugin-grid`'s `ObjectGrid` (twice),
  // `plugin-detail`'s `RelatedList` and `plugin-form`'s `LineItemsPanel` all
  // call `toFilterNode` inside a RENDER-time `useMemo`, where a throw
  // propagates as a render error with no `classifyLoadError` in the path.
  // `ObjectGrid` feeds it `schema.filter`, which the spec declares as
  // `z.array(ViewFilterRuleSchema)` — i.e. exactly the shape this arm judges.
  //
  // That is objectui#9050, an OPEN card on the DELIVERY axis, and this arm
  // deliberately does not pre-empt it. It is not a class this card creates or
  // even joins first: objectui#8557's array-arity refusal directly above throws
  // from this same function through those same four entries and has shipped
  // that way, and objectui#9050 counts eleven pre-existing throw sites reachable
  // the same way. ⛔ The alternatives are worse in the direction this whole card
  // family exists to close — dropping the rule widens the result set, lowering
  // it keeps the two-answers split. So the refusal lands and WHERE it surfaces
  // stays objectui#9050's decision to make for all thirteen at once.
  if (
    operator === 'icontains'
    && rule.value !== undefined
    && isRefusedTextComparand(rule.value)
  ) {
    // The spelling that ARRIVED, never `$icontains` substituted for it. The
    // published rows spell the operator `$icontains` because their filters are
    // written in the `$` dialect; a view rule spells the same operator
    // `icontains`, and `ValueDataSource` already answers this question the same
    // way on today's tree — its `$` arm names `$icontains`, its AST arm names
    // `icontains`, each from the node in hand. Prescribing a spelling this
    // vocabulary does not have would send a view author looking for a `$` key
    // their metadata cannot contain, so the `$` twin is NAMED in the tail below
    // instead of substituted for what they wrote.
    const arrived = typeof rule.operator === 'string' && rule.operator !== ''
      ? rule.operator
      : operator;
    const tail =
      `This is a STORED VIEW rule, so it is refused as the filter is BUILT rather `
      + `than lowered onto the wire: the spelling @objectstack/spec's `
      + `FILTER_TEXT_CASES uses for this operator is the $-dialect '$icontains', `
      + `which this vocabulary spells '${arrived}'. Remove the condition from the `
      + `view, or give it a non-empty string comparand (objectui#9048; the same `
      + `refusal ValueDataSource and convertFiltersToAST already share).`;
    throw new FilterOperatorError(
      `[ObjectUI] The ${textComparandRefusalReason(rule.field, arrived, rule.value)}. ${tail}`,
      { operator: arrived, field: rule.field },
    );
  }

  return (
    rule.value === undefined
      ? [rule.field, operator]
      : [rule.field, operator, rule.value]
  ) as FilterNode;
}

/**
 * Normalize ONE filter source into a single filter node.
 *
 * A "source" is whatever a view hands a renderer, and there are three shapes in
 * circulation, all legitimate:
 *
 *   - `[{ field, operator, value }, ...]`  a spec `ViewFilterRule[]`
 *   - `[['stage', '=', 'won'], ...]`       an AST node / legacy flat array
 *   - `{ status: 'active' }`               a MongoDB-style object
 *
 * The third is the one that kept getting lost. Renderers tested `source.length
 * > 0` before using it, which is `undefined > 0` for an object — so a
 * `table.defaultFilters` (declared `Record<string, any>` until objectui#6152
 * round 10; the protocol's `ViewFilterRule` array since, and the record no
 * longer validates there) was DROPPED and the view returned every record.
 * Silently: no error, just a wider answer. That narrowing moved what an author
 * may write, not this sink: the object arm below still lowers a record whatever
 * caller hands it one.
 *
 * The FIRST never worked at all (objectui#3431). The array branch returned
 * every array VERBATIM, so a saved view's `ViewFilterRule[]` travelled to
 * `$filter` as bare rule objects — which the server refuses: `isFilterAST` is
 * false for an array of objects, and the wire face answers `400
 * INVALID_FILTER`. Verified against a real backend on the showcase's SHIPPED
 * `showcase_task.in_progress` view (`filter: [{field:'status',
 * operator:'equals', value:'in_progress'}]`): 400 as sent, 200 with its 2 rows
 * once lowered to `[['status','equals','in_progress']]`. Every saved view
 * carrying a filter was a failed list. `mergeFilterNodes` below has warned
 * about exactly this hazard since it was written — the warning was accurate,
 * and the sink it warns for never implemented the lowering it describes.
 *
 * **Why the fold lives HERE and not at the producer.** `ListViewSchema.filter`
 * / `ViewTab.filter` are spec-declared `z.array(ViewFilterRuleSchema)`, and a
 * view hands a renderer a `ListViewSchema` — so folding one hop earlier (in
 * `app-shell`'s ObjectView, say) would write ObjectQL AST triples INTO a
 * spec-declared rule-array slot: an off-spec value in a spec field, AGENTS.md
 * #0.1 inverted. This function is the last hop before the wire, where the value
 * legitimately leaves the spec's view vocabulary and becomes an ObjectQL AST.
 * It is also the single sink both producers already share — `plugin-list`'s
 * `buildEffectiveFilter` (which feeds the grid AND the export) and
 * `plugin-view`'s ObjectView (calendar / kanban / gallery / timeline). One
 * lowering, one place; the same reason the MongoDB-style shape is lowered here
 * rather than at each of its callers.
 *
 * Mixed arrays fold ELEMENT-WISE, because that is what reaches this function in
 * practice: `ObjectView` concatenates a saved view's rules with the
 * `?filter[<field>]=<value>` URL triples into one array. Triples pass through
 * untouched.
 *
 * Returns `undefined` for an absent or empty source, so callers can skip
 * `$filter` rather than sending an empty array — and, since objectui#8770, for
 * an object source that is nothing but TRUE-identity combinators
 * (`{ $and: [] }`), and since objectui#9020 for one whose every key is skipped
 * for a null/undefined value (`{ a: null }`). Both constrain nothing and so
 * contribute nothing to the `and` {@link mergeFilterNodes} builds. Those answers
 * are inherited from {@link convertFiltersToAST}, not decided a second time
 * here — including the fact that they are two separate decisions there.
 */
export function toFilterNode(source: unknown): FilterNode | Record<string, any> | undefined {
  if (source === null || source === undefined) return undefined;
  if (Array.isArray(source)) {
    if (source.length === 0) return undefined;
    // Spec `ViewFilterRule[]` (possibly mixed with AST nodes) → AST nodes. Left
    // untouched when the array holds no rule objects, which is the common case:
    // user-filter conditions and URL triples are already nodes.
    return (
      source.some(isViewFilterRule)
        ? source.map((el) => (isViewFilterRule(el) ? viewFilterRuleToNode(el) : el))
        : source
    ) as FilterNode;
  }
  if (typeof source !== 'object') return undefined;
  const obj = source as Record<string, any>;
  if (Object.keys(obj).length === 0) return undefined;
  // MongoDB-style → AST, so it can sit beside the other shapes under one `and`.
  return convertFiltersToAST(obj);
}

/**
 * {@link toFilterNode}'s answer for a caller that has no `catch` above it.
 *
 * ## Why this exists (objectui#9050, ruling C′ step 2)
 *
 * `toFilterNode` is documented as "the last stop before the wire", and the two
 * callers that reach the wire — `plugin-list`'s `buildEffectiveFilter` and
 * `plugin-view`'s `ObjectView` — do have a `catch`: they call it inside a load
 * `try`, `classifyLoadError` reads this file's `INVALID_FILTER` / 400 envelope,
 * and the author sees "this filter is malformed". Three OTHER callers reach it
 * from a RENDER-time `useMemo` (`plugin-detail`'s `RelatedList`,
 * `plugin-form`'s `LineItemsPanel`, `plugin-grid`'s `ObjectGrid`), where a
 * throw is a render error and there is no `classifyLoadError` in the path.
 * A fourth is an ADAPTER rather than a renderer: `ValueDataSource.find` lowers
 * an array `$filter` through this before matching it in memory
 * (objectui#10767), and a `find` that never threw on a bad filter must not
 * start to — it re-seats `refusal` as its own excluded-and-logged refusal.
 *
 * ## Why the return type is a UNION and not `node | undefined`
 *
 * Because `undefined` is the refused answer. A `try`/`catch` that swallows the
 * refusal and hands back `undefined` means NO FILTER — every row — which is a
 * silently unconstrained query on a view whose whole purpose can be to hide
 * rows, and is the failure objectui#9001 closed. So the refusal is not
 * representable as a node: `ok: false` carries the error and has no `node` to
 * read at all, and TypeScript makes a caller narrow before it can build a
 * query. That is the whole difference between this and a bare `catch`.
 *
 * ⚠️ Only a {@link FilterOperatorError} is caught. Anything else is a defect in
 * this file rather than a statement about the author's filter, and is rethrown
 * so it keeps reaching whatever boundary would have seen it — a render-time
 * `TypeError` swallowed into "your filter is malformed" would send the author
 * to edit a filter that is fine.
 */
export type FilterNodeResult =
  | { ok: true; node: FilterNode | Record<string, any> | undefined }
  | { ok: false; refusal: FilterOperatorError };

export function toFilterNodeSafely(source: unknown): FilterNodeResult {
  try {
    return { ok: true, node: toFilterNode(source) };
  } catch (error) {
    if (error instanceof FilterOperatorError) return { ok: false, refusal: error };
    throw error;
  }
}

/**
 * Combine filter sources under a single `and`, each as its OWN child.
 *
 * Wrapping rather than spreading, on purpose. `['and', ...rules]` looks
 * equivalent and is not: spreading a `ViewFilterRule[]` puts bare rule OBJECTS
 * where the AST expects nodes, and the server does not accept that —
 * `isFilterAST` says no and the wire face answers `400 INVALID_FILTER`
 * (objectstack#4121). Spreading is only correct when the source happens to be
 * an array of nodes, which is why it survived.
 *
 * Since objectui#3431 the rule objects never reach that position anyway:
 * `toFilterNode` lowers a `ViewFilterRule[]` to AST nodes on the way in. The
 * paragraph above is kept because it is why each source stays its own child —
 * and because it correctly diagnosed the bug the sink itself was carrying.
 *
 * Sources that normalize to nothing are skipped; one surviving source is
 * returned as-is rather than wrapped in a pointless `and`.
 */
export function mergeFilterNodes(
  ...sources: unknown[]
): FilterNode | Record<string, any> | undefined {
  const nodes = sources.map(toFilterNode).filter((n) => n !== undefined);
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return ['and', ...nodes] as FilterNode;
}
