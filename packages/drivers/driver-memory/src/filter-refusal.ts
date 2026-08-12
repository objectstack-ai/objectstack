// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The filter refusals this driver raises, in ONE place — and, since #5324/#5328,
 * the ONE walk that decides which shapes are refused at all.
 *
 * All THREE of this package's filter surfaces refuse the same shapes with the
 * same wire envelope: the live query path (`memory-driver.ts` → mingo), the
 * reference matcher (`memory-matcher.ts`, the record-at-a-time evaluator the
 * conformance suites hold against `driver-sql` and `@objectstack/formula`), and
 * since #5345 the analytics/cube face (`memory-analytics.ts`). They were
 * independent code paths with independent notions of what a filter may be, which
 * is exactly how #5240's divergence survived unnoticed in-package.
 *
 * #5240 gave the first two faces one refusal by writing the same check twice.
 * That was still two implementations of one rule, and the shapes #5324/#5328
 * measured proved how far apart two such implementations drift: given a
 * malformed `$between` the live path answered "no rows" while the matcher
 * answered "EVERY row" — opposite answers, inside one package, to one filter. So
 * the rule now lives in exactly one function, {@link assertFilterConditionShape},
 * and every face calls it before it evaluates anything.
 *
 * [#5345] The faces are not equally capable, and pretending they were is what
 * kept the third one out. `memory-analytics` lowers a `where` into a cube-style
 * `{member, operator, values}` list, and that pipeline expresses neither `$or`
 * nor `$not` nor five of the declared field operators. Its answer used to be a
 * `continue`. So the walk now takes the calling face's {@link
 * FilterFaceCapabilities} — what that face can COMPILE — and refuses what it
 * cannot, in the same envelope, from the same place. A face declares its
 * vocabulary; it does not get to drop what falls outside it.
 */

import { FILTER_OPERATORS, LOGICAL_OPERATORS, RETIRED_FILTER_OPERATORS } from '@objectstack/spec/data';
// [#7536] The `$like` pattern language's shared gate, so this driver refuses
// the same malformed patterns as every other face.
import { hasDanglingLikeEscape } from '@objectstack/spec/data';
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
 * ## [#5702] The two additions are GONE — nothing is added any more
 *
 * This set used to be `[...FILTER_OPERATORS, '$regex', '$options']`. Both extra
 * members existed for one reason, recorded here verbatim at the time: *"Refusing
 * it here would break a live producer"* — plugin-auth's ObjectQL adapter emitted
 * `{ field: { $regex: value } }` for better-auth's `contains` search, on the
 * AUTHENTICATION path.
 *
 * That producer was flipped to `$contains` by #5710 (PR #5812), and a whole-repo
 * scan on `origin/main` found no other: every surviving `$regex` occurrence is a
 * consumer arm, a retirement prescription, or a refusal assertion. The reason the
 * two members existed is therefore gone, and #4706 retired both spellings — so
 * they are refused here like any other undeclared operator, with the spec's
 * prescription attached (see {@link retiredFilterOperatorError}).
 *
 * ## [#6520] `$icontains` arrives here by DERIVATION, and that is the risk
 *
 * This set is `FILTER_OPERATORS` itself, so #6520 adding `$icontains` to the
 * spec admitted it here with no edit to this file. That is the property #5701
 * measured and warned about: while the matcher had no arm, admission alone
 * turned a loud refusal into `match({ name: 'zzz' }, { name: { $icontains:
 * 'acme' } }) === true` — the predicate dropped, every row matched, which on an
 * RLS read scope is a permission bypass rather than a degraded filter (#3948).
 *
 * So the arms and the word list HAD to land in one PR, and #6520 did that:
 * `memory-matcher.ts` and `memory-driver.ts` both carry a `$icontains` case, and
 * `memory-analytics.ts` lowers it too. Re-verified by deleting the matcher's arm
 * on the #6520 branch — with the name admitted, the reference matcher answered
 * EVERY row, which is the measurement, not a prediction.
 *
 * The lesson for the next operator is the ordering rather than this name: an
 * entry in `FILTER_OPERATORS` is a claim that this driver evaluates it, and this
 * file will make that claim on the spec's behalf whether or not it is true.
 *
 * ## [#7536] `$like` / `$ilike` arrive here EXPLICITLY, which is the other risk
 *
 * They are the mirror image of the paragraph above: declared by
 * `StringOperatorSchema`, deliberately staged OUT of `FILTER_OPERATORS` (see its
 * note) because `driver-mongodb`, objectql's `having` and `service-analytics`
 * have no arm for them — and added to this set BY HAND, because this driver
 * does. The precedent is `driver-turso`'s remote transport, whose
 * `SUPPORTED_FILTER_OPERATORS` has carried `...FILTER_OPERATORS, '$icontains'`
 * since #5702 for exactly this situation: a backend that implements one more
 * operator than the shared allowlist says so LOCALLY, rather than pushing the
 * allowlist ahead of the backends that cannot follow.
 *
 * Why this driver implements rather than refuses, when two of its siblings
 * refuse: it is the in-memory DOUBLE. An application whose tests run here and
 * whose production runs SQL would otherwise get a 400 in test for a filter that
 * works in production — which is the same "one filter, two answers" divergence
 * #6520 closed, wearing a refusal instead of a wrong row set. It is also the
 * one driver holding the `VALID_AST_OPERATORS` expressibility invariant
 * (`memory-filter-ast-vocabulary.test.ts`, #3948): every operator the protocol
 * PARSES must survive to a matched row here.
 *
 * The ordering rule from the `$icontains` paragraph applies unchanged and was
 * followed: both arms (`memory-driver.ts`'s query path and `memory-matcher.ts`)
 * landed in the same commit as this widening. A name added here with no arm
 * behind it is the #5701 measurement — gate stops refusing, matcher has no
 * case, predicate silently DROPPED, every row matches.
 *
 * Everything else is refused. That includes the mingo operators this driver used
 * to hand through by accident (`$elemMatch`, `$size`, `$type`, `$mod`, `$where`,
 * `$expr`, field-level `$not`) — none of them is in the Filter Protocol, none is
 * implemented by the matcher, and `driver-sql` refuses every one.
 */
export const SUPPORTED_FIELD_OPERATORS: ReadonlySet<string> = new Set<string>([
  ...FILTER_OPERATORS,
  '$like',
  '$ilike',
]);

/** The vocabulary as it appears in a refusal message, in declaration order. */
const SUPPORTED_FIELD_OPERATOR_LIST = [...SUPPORTED_FIELD_OPERATORS].join(', ');

/**
 * [#5345] What ONE evaluation face can COMPILE — the narrower vocabulary a
 * particular surface enforces on top of the package-wide one above.
 *
 * The distinction this type draws is the whole of #5345. Two different things
 * can be wrong with `{ amount: { $sounds_like: 3 } }` and
 * `{ amount: { $between: [1, 3] } }` on the analytics face:
 *
 * - the first names an operator the **Filter Protocol** does not declare — it is
 *   wrong everywhere, and {@link unknownFieldOperatorError} says so;
 * - the second is a declared operator this **face** cannot lower into its cube
 *   pipeline. It is a perfectly good filter that `find()` runs today.
 *
 * Before #5345 the second class was answered with `continue`, silently, on the
 * analytics face only. A face that declares its vocabulary here gets the second
 * class refused for it, by the same walk, in the same envelope — and, crucially,
 * cannot answer it any other way, because the walk runs before the face's
 * lowering code is reached.
 *
 * Derive the sets from the face's own lowering table rather than hand-listing
 * them (see `MONGO_TO_CUBE_OPERATOR` in `memory-analytics.ts`): a hand-written
 * copy agrees with the compiler on the day it is typed and never again, which is
 * the note already sitting over {@link SUPPORTED_FIELD_OPERATORS}.
 */
export interface FilterFaceCapabilities {
  /** How the face names itself in a refusal, e.g. `"the analytics (cube) face"`. */
  readonly face: string;
  /** The field operators this face lowers. A subset of {@link SUPPORTED_FIELD_OPERATORS}. */
  readonly fieldOperators: ReadonlySet<string>;
  /** The logical combinators this face lowers. A subset of `LOGICAL_OPERATORS`. */
  readonly combinators: ReadonlySet<string>;
}

/**
 * [#5345] The default: the whole vocabulary this driver's query path and
 * reference matcher evaluate. Passing no capabilities means "this face compiles
 * everything the driver does", which is true of both of them and keeps every
 * pre-#5345 call site behaving byte-for-byte as before.
 */
export const DRIVER_FILTER_CAPABILITIES: FilterFaceCapabilities = Object.freeze({
  face: 'this driver',
  fieldOperators: SUPPORTED_FIELD_OPERATORS,
  combinators: new Set<string>(LOGICAL_OPERATORS),
});

/**
 * [#5345] A DECLARED field operator that this face cannot lower.
 *
 * Distinct from {@link unknownFieldOperatorError} on purpose: that one means
 * "the Filter Protocol has no such operator", this one means "the protocol has
 * it, `find()` runs it, and this surface cannot". Collapsing them would tell a
 * dashboard author their `$between` is a typo.
 *
 * The tail is the #3948 rule stated in the direction that matters here. A
 * dropped predicate does not narrow a query, it WIDENS it: the aggregate is
 * computed over rows the author excluded, and a chart drawn over them looks
 * exactly like a working chart. This is ADR-0078 / #4286's call on `objectql`'s
 * `having`, which was refused rather than skipped for the identical reason.
 */
export function uncompilableFieldOperatorError(
  op: string,
  field: string,
  path: string,
  capabilities: FilterFaceCapabilities,
): Error {
  const supported = [...capabilities.fieldOperators].join(', ') || '(none)';
  return unsupportedFilterError(
    `Filter operator "${op}" on field "${field}" at ${path} is declared by the Filter Protocol ` +
      `but cannot be compiled by ${capabilities.face}. Supported operators on this surface: ` +
      `${supported}. It is refused rather than dropped: a predicate that compiles to nothing does ` +
      `not narrow the query, it WIDENS it — the aggregate is then computed over rows the filter ` +
      `excluded, and a chart drawn over them looks like a working chart (#3948, #4286/ADR-0078, ` +
      `#5345). Rewrite the predicate with a supported operator, or run it through find().`,
  );
}

/**
 * [#5345] A DECLARED logical combinator that this face cannot lower.
 *
 * Named separately from {@link unknownLogicalOperatorError} for the same reason
 * as the field-operator pair above, and it is the sharper half of #5345: a
 * dropped `$or` discards a whole branch of the filter, and `$not` is precisely
 * what `cel-to-filter.ts` compiles a CEL `!expr` RLS read scope into. Dropping
 * that one does not make a number inaccurate — it puts rows the caller has no
 * permission to read into the aggregate.
 */
export function uncompilableCombinatorError(
  key: string,
  path: string,
  capabilities: FilterFaceCapabilities,
): Error {
  const supported = [...capabilities.combinators].join(', ') || '(none)';
  return unsupportedFilterError(
    `Filter combinator "${key}" at ${path} is declared by the Filter Protocol but cannot be ` +
      `compiled by ${capabilities.face}. Supported combinators on this surface: ${supported}. ` +
      `It is refused rather than ignored: dropping a combinator discards a whole branch of the ` +
      `filter and WIDENS the result set, and "$not" is what compileCelToFilter emits for a CEL ` +
      `"!expr" RLS read scope — a dropped one is an over-permissive read, not an inaccurate ` +
      `number (#3948, #5345).`,
  );
}

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
 * [#5702] A RETIRED filter operator in a field constraint.
 *
 * Distinct from {@link unknownFieldOperatorError} on purpose, and the
 * distinction is the author's: `$sounds_like` is a name that never meant
 * anything, while `$regex` and `$options` are names this driver ANSWERED — with
 * a real `RegExp`, the only regex evaluator in the repo — until #4706 retired
 * them. Handing that author the fifteen-name vocabulary list is true and
 * useless; what they need is `$icontains`.
 *
 * The prescription is `RETIRED_FILTER_OPERATORS[op].why`, printed VERBATIM. The
 * spec table exists precisely so `driver-sql`, this driver, `driver-turso`'s
 * remote transport, `driver-mongodb` and `objectql`'s `having` stop each writing
 * their own sentence about one retirement (#5701).
 *
 * This subsumes the `$options`-with-no-`$regex` refusal #5324 added
 * (`danglingRegexOptionsError`, deleted with this change): while `$options` was
 * an allowlisted MODIFIER, a dangling one needed its own gate; now that both
 * spellings are refused outright there is no shape left for that gate to catch,
 * and the message it printed — which taught the reader to write
 * `{ "$regex": "abc", "$options": "i" }` — would be prescribing the retired form.
 *
 * `siblings` are the other keys of the SAME field constraint, and every retired
 * one among them is named too — `{ $regex: '^acme', $options: 'i' }` is ONE
 * mistake with ONE fix, and a message naming only the key iteration reached
 * first would send its author back for a second round-trip on the other.
 *
 * Returns `null` when `op` is not retired, so the caller falls through to the
 * ordinary unknown-operator refusal in one expression.
 */
export function retiredFilterOperatorError(
  op: string,
  field: string,
  path: string,
  siblings: readonly string[] = [],
): Error | null {
  const guidance = RETIRED_FILTER_OPERATORS[op];
  if (!guidance) return null;
  const replacement = guidance.to ? ` Write "${guidance.to}" instead.` : '';
  const alsoRetired = siblings.filter((key) => key !== op && RETIRED_FILTER_OPERATORS[key]);
  const also = alsoRetired.length
    ? ` The same field constraint also carries the retired ` +
      `${alsoRetired.map((key) => `"${key}"`).join(', ')} — one "${guidance.to}" replaces the whole ` +
      `shape, so this is ONE mistake with ONE fix, not one per key.`
    : '';
  return unsupportedFilterError(
    `Filter operator "${op}" on field "${field}" at ${path} is RETIRED and is no longer evaluated ` +
      `by this driver.${replacement} ${guidance.why}${also}`,
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
 *
 * ## What `capabilities` adds (#5345)
 *
 * Shape is universal; CAPABILITY is per-face. `capabilities` narrows what this
 * particular caller can lower — see {@link FilterFaceCapabilities} — and the
 * walk refuses the difference. It defaults to
 * {@link DRIVER_FILTER_CAPABILITIES}, i.e. everything, so the query path and the
 * matcher are unaffected.
 *
 * The capability check is made BEFORE the shape checks at the same key, and
 * deliberately: on a face that cannot compile `$or` at all, reporting that its
 * operand should have been an array would send the author to fix the wrong
 * thing, then refuse the corrected filter anyway.
 */
export function assertFilterConditionShape(
  node: unknown,
  path: string,
  capabilities: FilterFaceCapabilities = DRIVER_FILTER_CAPABILITIES,
): void {
  if (!isFilterNode(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      if (!capabilities.combinators.has(key)) throw uncompilableCombinatorError(key, here, capabilities);
      if (!Array.isArray(value)) throw filterNodeListExpectedError(key, value, here);
      value.forEach((child, index) => {
        const childPath = `${here}[${index}]`;
        if (!isFilterNode(child)) throw filterNodeExpectedError(child, childPath);
        assertFilterConditionShape(child, childPath, capabilities);
      });
      continue;
    }
    if (key === '$not') {
      if (!capabilities.combinators.has(key)) throw uncompilableCombinatorError(key, here, capabilities);
      if (!isFilterNode(value)) throw filterNodeExpectedError(value, here);
      assertFilterConditionShape(value, here, capabilities);
      continue;
    }
    if (key.startsWith('$')) throw unknownLogicalOperatorError(key, here);
    assertFieldConstraintShape(key, value, here, capabilities);
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
function assertFieldConstraintShape(
  field: string,
  spec: unknown,
  path: string,
  capabilities: FilterFaceCapabilities,
): void {
  if (!isFilterNode(spec)) return;
  // [#5240] The zero-operator constraint keeps its own predicate rather than an
  // inlined `keys.length === 0`, so the reasoning for what does and does not
  // count as one (a `Date` enumerates to nothing but is a comparand) stays
  // attached to the check that applies it.
  if (isEmptyFieldConstraint(spec)) throw emptyFieldConstraintError(field, path);
  const keys = Object.keys(spec);
  if (!keys.some((key) => key.startsWith('$'))) return;
  for (const op of keys) {
    if (!SUPPORTED_FIELD_OPERATORS.has(op)) {
      // [#5702] A RETIRED spelling gets the prescription; anything else gets
      // the vocabulary. Checked in this order because `$regex` satisfies both
      // descriptions ("not supported" and "retired") and only the second one
      // tells its author what to write.
      throw retiredFilterOperatorError(op, field, path, keys) ?? unknownFieldOperatorError(op, field, path);
    }
    // [#5345] Declared, but not by THIS face. Checked before the comparand-shape
    // rules below so a `$between` a face cannot compile is reported as
    // unsupported-here rather than as a malformed range the face would refuse
    // even once corrected.
    if (!capabilities.fieldOperators.has(op)) {
      throw uncompilableFieldOperatorError(op, field, path, capabilities);
    }
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
    // [#6520] `$icontains`' comparand is a NON-EMPTY string, the third
    // comparand-shape rule and the twin of `driver-sql`'s
    // `icontainsComparandError` — deliberately the same two rejections in one
    // check, because they are one mistake at one position.
    if (op === '$icontains' && (typeof spec[op] !== 'string' || spec[op] === '')) {
      throw icontainsComparandError(field, spec[op], `${path}.$icontains`);
    }
    // [#7536] `$like` / `$ilike` carry a PATTERN. Two rules, both of them
    // driver-sql's word for word so a suite that swaps this driver for SQL sees
    // the same refusal for the same input.
    //
    // Note what is deliberately NOT refused: an EMPTY pattern. `$icontains: ''`
    // is refused just above because every row contains the empty substring —
    // but `LIKE ''` matches only the empty string, a narrow and well-formed
    // predicate. Copying the neighbour's rule would refuse a legitimate query.
    if (op === '$like' || op === '$ilike') {
      if (typeof spec[op] !== 'string') {
        throw likePatternComparandError(field, op, spec[op], `${path}.${op}`);
      }
      if (hasDanglingLikeEscape(spec[op] as string)) {
        throw danglingLikeEscapeError(field, op, spec[op] as string, `${path}.${op}`);
      }
    }
  }
  // [#5702] The `$options`-without-`$regex` companion check that stood here is
  // GONE. It was needed while `$options` was an allowlisted MODIFIER — a key the
  // vocabulary accepted but which is not a predicate on its own. Both spellings
  // are retired now, so the loop above refuses either of them on sight and there
  // is no surviving shape for a companion rule to judge. See
  // {@link retiredFilterOperatorError}.
}

/**
 * [#6520] `$icontains` received a comparand that is not a non-empty string.
 *
 * Word for word `driver-sql`'s `icontainsComparandError`, and deliberately so:
 * #3948 made the backends agree that an uncompilable filter is a refusal rather
 * than a silent match-everything, and a suite that swaps this driver for SQL has
 * to see the same refusal for the same input. Two rejections, one constructor,
 * because they are one mistake at the comparand position:
 *
 * - **non-string** — `StringOperatorSchema` declares `$icontains: z.string()`,
 *   so coercing `42` to `"42"` would answer a query nobody wrote;
 * - **empty string** — every row contains the empty substring, so the predicate
 *   constrains nothing. A dropped predicate WIDENS a result set, and on an RLS
 *   read scope that is a permission bypass rather than a degraded filter.
 */
/**
 * [#7536] `$like` / `$ilike` received a comparand that is not a string.
 *
 * `driver-sql`'s `likePatternComparandError`, word for word, for the reason its
 * `$icontains` neighbour gives. Coercion is worse for a pattern than for text:
 * `String({})` is `[object Object]`, and once that reaches the SQL family's
 * SQLite arm its `[` OPENS a GLOB character class — so the query would run a
 * PATTERN nobody wrote rather than merely compare text nobody wrote.
 */
export function likePatternComparandError(
  field: string,
  op: string,
  value: unknown,
  path = 'filter',
): Error {
  return unsupportedFilterError(
    `Operator "${op}" on field "${field}" at ${path} requires a string comparand, received ` +
      `${JSON.stringify(value) ?? String(value)}. "${op}" takes a PATTERN — "%" matches any ` +
      `sequence, "_" matches one character, and a backslash escapes either — so a non-string ` +
      `comparand cannot be coerced without inventing wildcards the caller never wrote. For a ` +
      `literal substring search write "$contains", whose comparand IS text.`,
  );
}

/**
 * [#7536] A `$like` / `$ilike` pattern ending in a lone unpaired backslash.
 *
 * Refused rather than given a meaning because no meaning survives every
 * backend: Postgres rejects such a pattern outright, SQLite's GLOB has no
 * escape character at all, and a JS translation would have to invent a third
 * answer. `hasDanglingLikeEscape` is the spec's shared test, so every face
 * refuses the SAME patterns.
 */
export function danglingLikeEscapeError(
  field: string,
  op: string,
  pattern: string,
  path = 'filter',
): Error {
  return unsupportedFilterError(
    `Operator "${op}" on field "${field}" at ${path} has a pattern ending in a lone unpaired ` +
      `backslash (${JSON.stringify(pattern)}). A backslash escapes the character after it, so a ` +
      `trailing one escapes nothing and the backends disagree about what it means. Write ` +
      `"\\\\\\\\" to match a literal backslash, or drop the trailing one.`,
  );
}

function icontainsComparandError(field: string, value: unknown, path: string): Error {
  const shown = typeof value === 'string' ? `""` : JSON.stringify(value) ?? String(value);
  return unsupportedFilterError(
    `Operator "$icontains" on field "${field}" at ${path} requires a NON-EMPTY string comparand, ` +
      `received ${shown}. "$icontains" is a case-insensitive LITERAL substring search, so its ` +
      `comparand is the text to look for — an empty one matches every row (a predicate that ` +
      `constrains nothing), and a non-string one would have to be coerced into text this query ` +
      `never asked for.`,
  );
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
