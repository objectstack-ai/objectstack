// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filter refusals this driver raises, in ONE place — and, since #5324/#5328,
 * the ONE walk that decides which shapes are refused at all.
 *
 * Both of this package's filter surfaces refuse the same shapes with the same
 * wire envelope: the live query path (`memory-driver.ts` → mingo) and the
 * reference matcher (`memory-matcher.ts`, the record-at-a-time evaluator the
 * conformance suites hold against `driver-sql` and `@objectstack/formula`). They
 * were two independent code paths with two independent notions of what a filter
 * may be, which is exactly how #5240's divergence survived unnoticed in-package.
 *
 * #5240 gave the two faces one refusal by writing the same check twice. That was
 * still two implementations of one rule, and the shapes #5324/#5328 measured
 * proved how far apart two such implementations drift: given a malformed
 * `$between` the live path answered "no rows" while the matcher answered "EVERY
 * row" — opposite answers, inside one package, to one filter. So the rule now
 * lives in exactly one function, {@link assertFilterConditionShape}, and both
 * faces call it before they evaluate anything.
 */

import { FILTER_OPERATORS } from '@objectstack/spec/data';
import { StandardErrorCode } from '@objectstack/spec/api';

/**
 * [#4436] A filter this driver cannot evaluate — see the twin in `driver-sql`'s
 * `unsupportedFilterError`, which carries the full rationale.
 *
 * Kept in lockstep with driver-sql deliberately: #3948 made the two backends
 * AGREE that an uncompilable filter is a refusal rather than a silent
 * match-everything, and the refusal's wire envelope has to agree too. A test
 * suite that swaps the memory driver for SQL must see the same `400
 * INVALID_FILTER`, not a coded refusal on one backend and a bare `{error}` on
 * the other.
 */
export function unsupportedFilterError(message: string): Error {
  const err = new Error(message) as Error & { code?: string; status?: number };
  err.code = StandardErrorCode.enum.INVALID_FILTER;
  err.status = 400;
  return err;
}

/**
 * [#5158] A `FilterArray` reached the driver unlowered.
 *
 * `where` is a `FilterCondition` — `QueryASTSchema.where: FilterConditionSchema`
 * — and `FilterArray` is INPUT-ONLY authoring sugar the spec declares separately
 * (`spec/data/filter.zod.ts`, #5285). Both doors into the runtime lower it
 * through `parseFilterAST` before any driver is reached: the protocol face
 * (`metadata-protocol`) and the engine (`ObjectQL`, maintainer ruling C).
 *
 * The twin of `driver-sql`'s `filterArrayReachedDriverError`, and deliberately
 * word-for-word: #3948 made the two backends AGREE that an uncompilable filter
 * is a loud refusal rather than a silent match-everything, and the four drivers
 * each carrying their own array compiler is how they drifted apart in the first
 * place. cloud's `RemoteTransport.buildWhereSQL` already refuses this input
 * (cloud#1075); deleting the dialect here converges the product on one answer.
 */
export function filterArrayReachedDriverError(filters: unknown[]): Error {
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
 * Is `value` a Filter Protocol NODE — the shape `FilterConditionSchema` declares
 * for a `where`, for every element of `$and`/`$or`, and for the operand of
 * `$not`?
 *
 * The prototype check is load-bearing, not pedantry, and for the same reason it
 * is in `driver-sql`'s twin: a `Date`, a `RegExp`, a `Map` or a class instance
 * all satisfy `typeof x === 'object' && !Array.isArray(x)` while enumerating to
 * nothing, so accepting them would let a garbage operand read as the empty node
 * — which means "matches every row". A filter condition always arrives as JSON
 * or as the output of `compileCelToFilter`, i.e. a plain object.
 */
export function isFilterNode(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * [#5240] Is this field spec `{}` — a field constrained by ZERO operators?
 *
 * A plain object with no own enumerable keys, and nothing else: a `Date`, a
 * `RegExp` or a class instance also enumerates to nothing but is a COMPARAND,
 * not a constraint, and is left to the paths that already handle it.
 */
export function isEmptyFieldConstraint(spec: unknown): boolean {
  return isFilterNode(spec) && Object.keys(spec).length === 0;
}

/**
 * [#5240] `{ field: {} }` — a field constrained by ZERO operators.
 *
 * One declared shape, three answers across the repo: `driver-sql` refused it at
 * the top level but DROPPED it inside `$and`/`$or`/`$not` (a predicate that
 * emits nothing matches every row), while this driver and `@objectstack/formula`
 * answered "matches nothing" — this one only incidentally, by falling through to
 * a structural-equality comparison against the empty object.
 *
 * Ruled on #5240: refused everywhere, in the ADR-0112 envelope every sibling
 * filter refusal speaks. The shape is almost always an authoring accident (a
 * filter builder that recorded a field and never its operator, or generated
 * metadata that lost one), and both silent readings answer it with a row count
 * the author never asked for. This driver's incidental FALSE is the clearest
 * case of that: `{ status: {} }` did not mean "no rows", it meant "rows whose
 * `status` is literally the empty object" — a different filter that HAPPENS to
 * match nothing in ordinary data.
 */
export function emptyFieldConstraintError(field: string, path: string): Error {
  return unsupportedFilterError(
    `Field constraint at ${path} carries zero operators ({ "${field}": {} }). A field constraint ` +
      `must name at least one operator (e.g. { "${field}": { "$eq": "value" } }) or be a direct ` +
      `comparand (e.g. { "${field}": "value" }). It is refused rather than evaluated because the ` +
      `backends disagreed on what it means — driver-sql dropped it inside $and/$or/$not (matching ` +
      `EVERY row) while refusing it at the top level, and this driver / @objectstack/formula ` +
      `answered "matches nothing". #5240.`,
  );
}

// ── [#5324 / #5328] The vocabulary, and the walk that enforces it ────────────

/**
 * [#5324] The field-level operators this driver EVALUATES.
 *
 * Sourced from the spec's own `FILTER_OPERATORS` rather than hand-listed here.
 * A private copy of the vocabulary is precisely what let this driver and
 * driver-sql accept different operator sets (#3948, and the same note sits over
 * `convertConditionToMongo`'s alias fold) — a list written out here would agree
 * with the spec on the day it was typed and never again.
 *
 * Two additions the spec's list does not carry, both deliberate and both
 * pre-existing behaviour rather than new capability:
 *
 * - **`$regex`** — not in `FILTER_OPERATORS`, but really produced: plugin-auth's
 *   ObjectQL adapter emits `{ field: { $regex: value } }` for a `contains`
 *   search. `driver-sql` compiles it (to a substring LIKE), `objectql`'s
 *   `having` allows it, and this driver's matcher implements it. Refusing it
 *   here would break a live producer.
 * - **`$options`** — the regex-flags companion `memory-matcher` reads
 *   (`new RegExp(target, condition.$options)`) and `objectql`'s `having` skips
 *   for the same reason. It is a modifier of `$regex`, not a predicate of its
 *   own.
 *
 * Everything else is refused. That includes the mingo operators this driver used
 * to hand through by accident (`$elemMatch`, `$size`, `$type`, `$mod`, `$where`,
 * `$expr`, field-level `$not`) — none of them is in the Filter Protocol, none is
 * implemented by the matcher, and `driver-sql` refuses every one.
 */
export const SUPPORTED_FIELD_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...FILTER_OPERATORS,
  '$regex',
  '$options',
]);

/** The vocabulary as it appears in a refusal message, in declaration order. */
const SUPPORTED_FIELD_OPERATOR_LIST = [...SUPPORTED_FIELD_OPERATORS].join(', ');

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
 * [#5324] An operator this driver cannot evaluate, in a field constraint.
 *
 * The leading sentence is `driver-sql`'s, verbatim — one condition, one wording
 * (#5240) — and the supported list is generated from
 * {@link SUPPORTED_FIELD_OPERATORS} so it cannot drift from what the driver
 * actually accepts.
 *
 * What this replaces: `normalizeFieldOperators` had a `default: result[op] = val`
 * arm that handed any unrecognised `$op` to mingo unchanged. mingo then raised
 * its own `MingoError` — no `code`, no `status` — which `mapDataError` served
 * through its default branch as a bare 500-shaped `{ error }`, OUTSIDE the
 * ADR-0112 envelope this driver's every other filter refusal speaks. The refusal
 * was happening; only the envelope was lost. `$not` in a document position (the
 * shape #5324 was filed on) and `{ name: { $sounds_like: 'x' } }` are the same
 * hole seen from two sides.
 */
export function unknownFieldOperatorError(op: string, field: string, path: string): Error {
  return unsupportedFilterError(
    `Unsupported filter operator "${op}" on field "${field}". ` +
      `Supported operators: ${SUPPORTED_FIELD_OPERATOR_LIST}. ` +
      `Refused at ${path} rather than handed to the query engine, which answers an unknown ` +
      `operator with an error carrying no code and no status — a 500-shaped body for what is a ` +
      `400-class client mistake (#5324).`,
  );
}

/**
 * [#5324] A `$`-key in a NODE position that is not a declared combinator.
 *
 * `FilterConditionSchema` declares exactly three (`LOGICAL_OPERATORS`:
 * `$and`, `$or`, `$not`); a node's other keys are field names. `$nor`, `$where`,
 * `$expr` and friends were passed through to mingo verbatim by the same
 * `result[key] = value` reflex the field-level arm had.
 */
export function unknownLogicalOperatorError(key: string, path: string): Error {
  return unsupportedFilterError(
    `Unsupported filter combinator "${key}" at ${path}. A filter node's $-prefixed keys are the ` +
      `declared logical operators $and, $or and $not (@objectstack/spec LOGICAL_OPERATORS); every ` +
      `other key is a field name. It is refused rather than passed through to the query engine, ` +
      `which would answer with an uncoded error — or, worse, evaluate an operator the Filter ` +
      `Protocol never declared (#5324).`,
  );
}

/**
 * [#5328] `$between` whose comparand is not a two-element `[min, max]` array.
 *
 * The leading sentence is `driver-sql`'s, verbatim, and this is the ONE wording
 * every position in this package uses for the condition (#5240) — the FilterCondition
 * `$between` arm, and the QueryAST `between` comparison beside it.
 *
 * The tail says what this driver used to do, because it is the sharpest
 * illustration in the package of why a shape gate belongs in ONE place: one
 * malformed filter, three silent answers that did not agree. The live path
 * dropped the arm, so the field normalised to `{}` and mingo read it as "matches
 * no row"; the matcher's `Array.isArray(target) && …` guard skipped the
 * comparison and answered "matches EVERY row"; the AST comparison returned no
 * node at all, which the caller reads as "no filter". Not one of them reported
 * that the predicate had not been compiled, and `if (!rows.length)` cannot tell
 * "genuinely none" from "the range never ran".
 */
export function malformedBetweenError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$between" on field "${field}" requires a [min, max] value array. ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `It is refused rather than skipped: a range that compiles to no predicate answers with a ` +
      `row count the author never asked for, and this driver's faces did not even agree on ` +
      `WHICH — the live query path returned NO rows, the reference matcher returned EVERY row, ` +
      `and a dropped AST comparison would have matched every record (#5328).`,
  );
}

/**
 * [#5347] `$null` whose comparand is not a boolean.
 *
 * `FieldOperatorsSchema` declares `$null: z.boolean()`, and nothing between an
 * authored `where` and a driver validates against it — so a non-boolean really
 * arrives. Every backend then read it, and they did NOT agree; measured on one
 * row with `stage: 'won'` and one with `stage: null`, on `{ stage: { $null: 'yes' } }`:
 *
 * | backend | read as | rows |
 * |---|---|---|
 * | driver-sql / driver-sqlite-wasm / Turso local | IS NULL (anything but `false`) | the NULL row |
 * | THIS driver's live path (mingo), driver-mongodb | IS NOT NULL (anything but `true`) | the valued row |
 * | THIS driver's reference matcher | nothing at all — the constraint vanished | BOTH rows |
 *
 * Note the last line: this package's own two faces disagreed with EACH OTHER,
 * which #5347 could not see because it measured a fixture with no null-valued
 * row — there the matcher's "match everything" and mingo's "IS NOT NULL"
 * coincide. The matcher's `$null` arm is written as two conditionals
 * (`target === true && …`, `target === false && …`); a third value satisfies
 * neither, so the operator silently stopped constraining anything. That is the
 * #5240 / #5328 shape exactly — one filter, one package, two answers, and the
 * widening one is a permission bypass on a read scope.
 *
 * Ruled on #5347: REFUSED everywhere, the same disposition `{ field: {} }` got
 * and for the same reason — there is no reading of a non-boolean here that is
 * not a guess about the author's intent. The string `"false"` is the sharpest
 * case: it is truthy, so it landed on the opposite side from the `false` it was
 * written to mean, and it is exactly what an AI-authored or JSON-round-tripped
 * scope produces.
 *
 * The leading sentence is `driver-sql`'s, verbatim — one condition, one wording
 * (#5240).
 */
export function nonBooleanNullComparandError(field: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Operator "$null" on field "${field}" requires a boolean comparand (true or false). ` +
      `Received ${describeFilterOperand(value)} (${safeShapePreview(value)}) at ${path}. ` +
      `@objectstack/spec FieldOperatorsSchema declares $null as a boolean. It is refused rather ` +
      `than coerced because the backends read a non-boolean in OPPOSITE directions — driver-sql ` +
      `compiled IS NULL (anything but false), this driver's query path and driver-mongodb ` +
      `compiled IS NOT NULL (anything but true), and this driver's matcher dropped the ` +
      `constraint entirely. Note "false" the STRING is truthy, so it landed on the side opposite ` +
      `the false it was written to mean (#5347).`,
  );
}

/**
 * [#5324] `$options` without the `$regex` it modifies.
 *
 * `$options` is in {@link SUPPORTED_FIELD_OPERATORS} as a MODIFIER, not a
 * predicate — it carries the regex flags (`memory-matcher` reads it as
 * `new RegExp(target, condition.$options)`, and objectql's `having` skips it for
 * the same reason). On its own it is not a filter at all, and the two faces
 * proved it: mingo raised `unknown query operator $options` — uncoded, the very
 * escape #5324 is about — while the matcher ignored it and matched EVERY row.
 * Allowlisting the key without requiring its partner would have left exactly one
 * operator still leaking out of the envelope.
 */
export function danglingRegexOptionsError(field: string, path: string): Error {
  return unsupportedFilterError(
    `Operator "$options" on field "${field}" at ${path} has no "$regex" to modify. "$options" ` +
      `carries the flags of a regex predicate (e.g. { "${field}": { "$regex": "abc", "$options": "i" } }); ` +
      `it is not a predicate on its own. It is refused rather than ignored because the two ` +
      `evaluation paths answered it differently — one raised an uncoded engine error, the other ` +
      `matched every row (#5324).`,
  );
}

/** [#5324] `$and`/`$or` take a list of nodes; anything else is refused. */
export function filterNodeListExpectedError(key: string, value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Filter combinator "${key}" at ${path} requires an array of filter conditions, but received a ` +
      `${describeFilterOperand(value)} (${safeShapePreview(value)}). @objectstack/spec ` +
      `FilterConditionSchema declares "${key}" as FilterCondition[].`,
  );
}

/** [#5324] Every `$and`/`$or` element and every `$not` operand is a node. */
export function filterNodeExpectedError(value: unknown, path: string): Error {
  return unsupportedFilterError(
    `Filter node at ${path} is a ${describeFilterOperand(value)} (${safeShapePreview(value)}), not a ` +
      `filter condition object. Every element of "$and"/"$or" and the operand of "$not" must be a ` +
      `plain object of field constraints (e.g. { "status": "active" }) or nested combinators — ` +
      `@objectstack/spec FilterConditionSchema declares this position as a FilterCondition. It is ` +
      `refused rather than skipped because skipping it would silently change which rows match.`,
  );
}

/**
 * [#5324 / #5328] The ONE shape gate, walked before either face evaluates.
 *
 * ## Why up front, and why exhaustive
 *
 * The same two reasons #5240 wrote down for the matcher, now carrying more
 * weight because the walk decides more:
 *
 * 1. **Evaluation short-circuits, a refusal must not.** Both faces stop at the
 *    first failing key (`every`/`some`, mingo's own predicate composition), so a
 *    refusal raised mid-evaluation would fire or not fire depending on the
 *    RECORD being tested. A malformed filter has to be refused for every record
 *    or none — otherwise a permission rule is valid or invalid by luck of the
 *    data.
 * 2. **It does not short-circuit on identities either.** `{ $or: [ { a: {} }, {} ] }`
 *    has a TRUE disjunct that would let an emitter return before it ever reached
 *    the malformed one. Same argument as `driver-sql`'s `reduceFilterNode`, whose
 *    doc comment calls this "a gate conditional on evaluation order".
 *
 * ## What it does NOT do
 *
 * It decides SHAPE, never MEANING: no verdict, no rewriting, no coercion. Every
 * filter that evaluated before this gate existed still evaluates to the same
 * rows — the gate only converts shapes that were answered *silently* (an empty
 * result set, a full result set, or an uncoded `MingoError`) into a catalogued
 * `INVALID_FILTER` / 400.
 *
 * Deliberately NOT refused, because refusing them would be this driver
 * inventing a stricter contract than the backends it must agree with:
 *
 * - a field spec with NO `$` keys (`{ author: { name: 'x' } }`) — read as a
 *   deep-equality comparand here and by `driver-mongodb`, which is the reading
 *   that survives;
 * - the MEMBER types of a `$between` array — `driver-sql` checks its arity and
 *   nothing else (#5041 measured the member case and deliberately left it);
 * - a stringified comparand for the `LIKE` family — same, and fail-closed.
 */
export function assertFilterConditionShape(node: unknown, path: string): void {
  if (!isFilterNode(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (!Array.isArray(value)) throw filterNodeListExpectedError(key, value, here);
      value.forEach((child, index) => {
        const childPath = `${here}[${index}]`;
        if (!isFilterNode(child)) throw filterNodeExpectedError(child, childPath);
        assertFilterConditionShape(child, childPath);
      });
      continue;
    }
    if (key === '$not') {
      if (!isFilterNode(value)) throw filterNodeExpectedError(value, here);
      assertFilterConditionShape(value, here);
      continue;
    }
    if (key.startsWith('$')) throw unknownLogicalOperatorError(key, here);
    assertFieldConstraintShape(key, value, here);
  }
}

/**
 * [#5324 / #5328] One field constraint: `{ field: <spec> }`.
 *
 * A spec that is not a plain object is a COMPARAND (implicit equality) and has
 * no shape to check. A plain object is an operator map when it carries at least
 * one `$` key — the same test `driver-mongodb` and this package's matcher both
 * make — and then EVERY key must be an operator this driver evaluates. A mixed
 * `{ $eq: 1, name: 'x' }` is refused for the same reason a bare `{ $sounds_like }`
 * is: the two faces silently disagreed about it (the matcher ignored the
 * non-`$` key, mingo did not).
 */
function assertFieldConstraintShape(field: string, spec: unknown, path: string): void {
  if (!isFilterNode(spec)) return;
  // [#5240] The zero-operator constraint keeps its own predicate rather than an
  // inlined `keys.length === 0`, so the reasoning for what does and does not
  // count as one (a `Date` enumerates to nothing but is a comparand) stays
  // attached to the check that applies it.
  if (isEmptyFieldConstraint(spec)) throw emptyFieldConstraintError(field, path);
  const keys = Object.keys(spec);
  if (!keys.some((key) => key.startsWith('$'))) return;
  for (const op of keys) {
    if (!SUPPORTED_FIELD_OPERATORS.has(op)) throw unknownFieldOperatorError(op, field, path);
    if (op === '$between' && !isBetweenComparand(spec[op])) {
      throw malformedBetweenError(field, spec[op], `${path}.$between`);
    }
    // [#5347] `$null`'s comparand is a boolean by declaration. It joins
    // `$between`'s arity as the second COMPARAND-shape check this gate makes,
    // and for the identical reason: a shape the operator cannot evaluate was
    // being answered silently, differently, by each face.
    if (op === '$null' && typeof spec[op] !== 'boolean') {
      throw nonBooleanNullComparandError(field, spec[op], `${path}.$null`);
    }
  }
  // `$options` is the one entry in the vocabulary that is a modifier rather than
  // a predicate, so it is the one that needs a companion.
  if (keys.includes('$options') && !keys.includes('$regex')) throw danglingRegexOptionsError(field, path);
}

/**
 * [#5328] `$between`'s comparand: a two-element `[min, max]` array.
 *
 * Arity only — the same condition `driver-sql`'s `$between` arm applies
 * (`arr.length !== 2`). The member TYPES are left alone on purpose: ISO date
 * strings are a legitimate range on every backend, and tightening beyond
 * driver-sql here would replace one divergence with another.
 */
function isBetweenComparand(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2;
}
