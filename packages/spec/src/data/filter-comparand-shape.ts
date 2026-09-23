// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5869] The Filter Protocol's **comparand-shape door** for the LIST-SHAPED
 * operators — the one place that decides whether `$in` / `$nin` / `$between`
 * received a list at all, for every driver.
 *
 * `FieldOperatorsSchema` (`./filter.zod.ts`) declares three operators whose
 * comparand is a LIST rather than a scalar:
 *
 * ```
 * $in:      z.array(z.any())
 * $nin:     z.array(z.any())
 * $between: z.tuple([min, max])
 * ```
 *
 * Nothing enforced that declaration on the way in. `isFilterAST` checks the
 * OPERATOR and the tuple's arity, never the comparand's shape, and
 * {@link parseFilterAST} lowers `['status', 'not_in', 'done']` to
 * `{ status: { $nin: 'done' } }` — so a scalar reached the driver, where each
 * backend answered differently:
 *
 * | comparand              | driver-sql            | driver-memory        | driver-mongodb    |
 * |:-----------------------|:----------------------|:---------------------|:------------------|
 * | `$in` / `$nin` scalar  | `whereIn(f, scalar)` -> **500 DATABASE_ERROR** | evaluated as-is | emitted as-is |
 * | `$between` non-2-tuple | refused, 400          | refused, 400 (#5328) | arm falls through, no range predicate |
 *
 * The 500 is the reported defect (#5869): a server-fault code for a filter the
 * CALLER can fix, with no word about which operator, which field, or what shape
 * was expected. It is also reachable from spec-VALID authoring —
 * `ViewFilterRuleSchema.value` is `string | number | boolean | null | (string |
 * number)[]` and does not constrain the value by operator, so
 * `{ field: 'status', operator: 'not_in', value: 'done' }` publishes cleanly and
 * 500s on first render.
 *
 * ## Why here, and why this file is the ONLY implementation
 *
 * The table above IS the argument for a shared face: three backends, three
 * answers, one declared contract. `driver-memory` already carries a shape gate
 * (`filter-refusal.ts`), but it is that package's own and no other driver reads
 * it. The second reason this was first argued from — both driver families sat
 * under the #5499 maintainer investment freeze, so the policy could not be
 * grown per driver — no longer holds: that freeze was lifted on 2026-08-11
 * (recorded in `./aggregation-conformance.ts`). The table is the reason that
 * survives, and it was always the load-bearing one: growing the policy per
 * driver means one declared contract with an implementation per backend, which
 * is what the three rows above measured. #8234 settled the same question one
 * branch over for comparand TYPE — "enforced once at the shared compile face
 * for all five drivers" — and this file is that answer for comparand SHAPE.
 *
 * [#9228] It now lives in `packages/spec` rather than in the engine. The gate
 * shipped at `@objectstack/objectql`'s lowering seam (PR #6209), which covers
 * every query that reaches a driver THROUGH the engine — and nothing else. A
 * caller that compiles a filter with {@link parseFilterAST} and hands it
 * straight to a driver (`InMemoryDriver.find()`: an embedder, and this repo's
 * own driver conformance suites) met no gate at all. That path was carried by
 * mingo's own coercion of a non-array `$in`/`$nin` operand until mingo 7.2.3
 * removed it; from 7.2.4 on the same input escapes as an unhandled third-party
 * `TypeError` with no `code` and no `status`. Moving the rule to the face
 * {@link parseFilterAST} itself can reach closes that door for every driver at
 * once — the routing PR #8234 settled for the sibling comparand-TYPE question
 * one branch over ("enforced once at the shared compile face for all five
 * drivers"). `@objectstack/objectql`'s `assertListComparandShapes` is now a
 * delegating wrapper that supplies the engine's `find('deal')` context prefix;
 * there is exactly one implementation of "a list operator takes a list".
 *
 * ## Both engine doors, because only one of them carries an array
 *
 * The engine calls this on the LOWERED condition on both of its branches. Door
 * 2 is a direct in-process engine call carrying a `FilterArray`; Door 1 — the
 * protocol/HTTP face, the door #5869 was actually measured through — runs its
 * own `isFilterAST` -> {@link parseFilterAST} in `metadata-protocol` and hands
 * the engine an already-lowered `FilterCondition` OBJECT. A guard on the array
 * branch alone would therefore have left the reported defect exactly where it
 * was.
 *
 * ## Deliberately NOT refused
 *
 * - **`$in: []` / `$nin: []`.** An empty list is a legitimate, declared
 *   predicate — "matches nothing" and "matches everything" respectively — and
 *   both drivers say so in as many words. Arity is not this gate's business;
 *   only "is it a list at all".
 * - **The MEMBER types of any list — except `null`, refused BY RULING (next
 *   section).** `$between`'s members are otherwise checked by nobody
 *   (`driver-sql` checks arity and nothing else, and #5041 measured the
 *   member case and deliberately left it — ISO date strings are a legitimate
 *   range on every backend); `$in`/`$nin` members are #5234's subject, on the
 *   `driver-sql` object-syntax face, and are not re-judged here. The six
 *   accepted comparand TYPES are a different question, answered one file over
 *   by {@link normalizeFilterComparandTypes} (#7872).
 *
 * ## Refused BY RULING, 2026-08-31: a `null` list member (#13357)
 *
 * The carve-out is null-shaped and nothing wider. A `null` member of `$in` /
 * `$nin`, and a `null` `$between` endpoint (#13495's shape), are refused at
 * this door: no two backend camps ever agreed on what a null in a
 * list-comparand position matches (`$in: [null]` / `$nin: [null]` split the
 * reference matcher's two readings of "no value" while `$null` / `$ne: null`
 * agree, and the SQL family's `NOT IN` answer is unconditional), and the
 * maintainer ruled the divergence constructively unreachable rather than
 * reconciled — ⛔ no cross-backend alignment; #5299 stays declined, and the
 * matcher's own answers for these shapes are sealed behind this refusal, not
 * repaired. "Equals X or has no value" has an explicit spelling —
 * `$or: [{$in: […]}, {$null: true}]` — and the refusal text prescribes it.
 * #5041's question (ISO date strings as legitimate `$between` bounds) and
 * #5234's (object members on the `driver-sql` face) stand untouched.
 *
 * ## Refused BY RULING, 2026-09-01: a `null` ORDERING comparand (#14080)
 *
 * The same carve-out, one position over — and the last one. A `null`
 * comparand of `$gt` / `$gte` / `$lt` / `$lte` was the only null-comparand
 * position the contract neither RULED (`$eq: null` / `$ne: null` ARE the null
 * predicate, #5332) nor REFUSED (the list positions above): #5332's landing
 * had recorded it in writing as one "no ruling covers", and `driver-memory`'s
 * two faces answered it differently — the live path reads two absences as
 * EQUAL (so `$gte: null` admits the no-value row and `$gt: null` does not),
 * the reference matcher compares through JS coercion (`5 > null` is
 * `5 > 0`). Ruled 2026-09-01 (option A): refused at this door, same envelope,
 * so the divergent cells are constructively unreachable — ⛔ the matcher is
 * not repaired (dead code once refused), ⛔ no ordering-vs-null semantics is
 * defined anywhere (the live path's reading needs a strictness rule, "two
 * absences compare equal", that no ruling states), ⛔ no cross-backend
 * alignment. `null` is not ordered; the refusal text prescribes the ruled
 * spellings, `$eq: null` / `$ne: null`. Strictly `null`: `undefined` keeps the
 * TYPE door's own sentence (`undefinedComparandRefusal`, one file over), every
 * non-null comparand type and the `{ $field }` reference keep passing, and
 * `$eq` / `$ne` are untouched. The door's NAME predates both null carve-outs;
 * it stays, because the engine binds it by that name (`@objectstack/objectql`,
 * a delegating wrapper) and there is still exactly one implementation.
 * - **A field spec with no `$` keys** (`{ author: { name: 'x' } }`) — a
 *   deep-equality comparand to `driver-memory` and `driver-mongodb` alike. This
 *   gate does not descend into one: a comparand is data, and a stricter reading
 *   here would invent a contract no backend agrees with.
 *
 * ## Refused BY RULING, 2026-09-20: a BLANK `$between` ENDPOINT (#19071)
 *
 * The runtime twin of the schema door's 2026-09-17 rule (#18012). That ruling
 * wrote "BOTH are required NON-BLANK: an empty string, null and undefined are
 * refused, and the refusal names the blank side" into the PUBLISHED endpoint
 * contract (`RANGE_ENDPOINT_DESCRIPTION`, `./filter.zod.ts`) and enforced it at
 * the schema door alone. This door went on lowering `{ $between: ['', ''] }`
 * unchanged, so one published sentence had two truth values depending on which
 * door a caller came through — and the door that passed it is the one an
 * embedder reaches by handing a lowered filter straight to a driver, where the
 * range stops bounding on the blank side while still reading as a complete
 * range. Ruled 2026-09-20 (#19071, option A): the implementation follows the
 * declaration.
 *
 * The scope is the SCHEMA door's notion of blank, ⛔ not a second one invented
 * here — two doors disagreeing IS the defect:
 *
 * - **`''` and `undefined`** are refused, naming the blank side (MIN / MAX and
 *   the index) and carrying the schema door's own prescription.
 * - **`null`** keeps {@link nullRangeBoundError}, which prescribes the null
 *   PREDICATE: an author who wrote `null` was reaching for absence, an author
 *   who left a bound empty was reaching for a bound. Two blank spellings, two
 *   intents, two remedies; ⛔ do not unify them. It is checked FIRST, so a pair
 *   that is `null` on one side and blank on the other keeps the 2026-08-31
 *   message it has always had.
 * - **A whitespace-only endpoint is NOT judged**, because the schema door does
 *   not judge one: `RangeOperatorSchema.safeParse({ $between: [' ', 'M'] })`
 *   answers `success: true`, pinned deliberately in `filter.test.ts`. ⛔ A trim
 *   here would re-open the very split this ruling closes, in the opposite
 *   direction, and narrow a published face further than any ruling has.
 * - **Falsiness is untouched**: `[0, 0]` and `['0', '9']` are ranges, and a
 *   falsy `$in` / `$nin` MEMBER stays a value — #13357's rows stand, because
 *   this ruling is about range ENDPOINTS and those are about VALUES.
 *
 * ## Refused BY RULING, 2026-08-11: a `{ $field }` `$between` ENDPOINT (#7596)
 *
 * The OLDEST of the endpoint rulings and the last to reach this door. #7596
 * removed `FieldReferenceSchema` from both endpoint unions under ADR-0049
 * enforce-or-remove, because no backend ever resolved one in a list position:
 * `matches-filter.ts` leaves the list unresolved and orders against the raw
 * reference OBJECT, so it silently matches nothing, and both SQL faces refuse
 * the position with `INVALID_FILTER` / 400. The published endpoint contract
 * has said so verbatim ever since — "A { $field } reference is NOT an endpoint
 * shape" (`RANGE_ENDPOINT_DESCRIPTION`, `./filter.zod.ts`).
 *
 * It shipped at the SCHEMA door alone. This door went on lowering
 * `{ $between: [{ $field: 'a' }, 'M'] }` unchanged — one published sentence
 * with two truth values, decided by which door a caller came through, and the
 * door that passed it is the one an embedder reaches by handing a lowered
 * filter straight to a driver. Measured again under #19377 before the change;
 * closed here the way #19071 closed the blank spelling one endpoint over.
 *
 * The scope is the `$between` ENDPOINT position and nothing wider:
 *
 * - **Recognised by SHAPE** — a non-array object carrying a `$field` key,
 *   which is the schema door's own `isFieldReferenceShape` test, so the two
 *   doors cannot drift over what counts as a reference. ⛔ Not the comparand
 *   TYPE door's stricter `typeof value.$field === 'string'`: that door steps
 *   around references on purpose and refuses `{ $field: 42 }` as a plain
 *   object, and what this refusal has to name is the shape the author WROTE.
 * - **The reference stays legal in the four ORDERING slots** — #5222's
 *   shipped capability, and the alternative this refusal prescribes: a
 *   column-to-column range is its two bounds written separately,
 *   `{ $gte: { $field: 'a' }, $lte: { $field: 'b' } }`, which every face
 *   already answers.
 * - **`$in` / `$nin` MEMBERS are NOT judged here.** #7596 rules a reference
 *   out of those positions too and `SET_MEMBER_DESCRIPTION` publishes that
 *   rule, but this door still lowers such a member unchanged. That is a
 *   SECOND split over a different published sentence, needing its own wording
 *   and its own ruling; ⛔ absorbing it silently here is the exact move this
 *   card's family exists to refuse.
 * - **Checked LAST among the endpoint carve-outs**, after arity, `null` and
 *   blank. Every pair that already carried a refusal keeps the message it
 *   had — `[{ $field: 'a' }, null]` still answers with the 2026-08-31 null
 *   prescription — so this check changes the verdict only for pairs this door
 *   accepts today.
 *
 * ## Refusal envelope
 *
 * Every refusal carries `code: 'INVALID_FILTER'` and `status: 400` (ADR-0112
 * class 1 — a caller mistake). The literal is spelled here rather than imported
 * from `../api/errors.zod` because `api/` imports from `data/` and the reverse
 * edge would be a cycle — the same argument `filter-comparand-type.ts` records;
 * `filter-comparand-shape.test.ts` pins the literal to
 * `StandardErrorCode.enum.INVALID_FILTER` so the two cannot drift.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/5869 (the rule)
 * @see https://github.com/objectstack-ai/objectstack/issues/9228 (the move)
 */

/**
 * The operators whose comparand `FieldOperatorsSchema` declares as a list, with
 * the authoring spellings that lower to each.
 *
 * The spellings matter to the message and not to the check: an author writes
 * `not_in` on a `ViewFilterRule` and never types `$nin`, so a refusal naming
 * only the lowered form sends them looking for a key that is not in their
 * metadata. Values are the `AST_OPERATOR_MAP` keys (`./filter.zod.ts`) that map
 * to each `$` operator — spelled here rather than derived from that table
 * because `filter.zod.ts` imports THIS module, and the reverse edge would be a
 * cycle. `filter-comparand-shape.test.ts` reconciles the two sets, so a new
 * membership spelling cannot land with this message left behind.
 */
const LIST_COMPARAND_OPERATORS: ReadonlyMap<string, readonly string[]> = new Map([
  ['$in', ['in']],
  ['$nin', ['nin', 'not_in', 'notin']],
  ['$between', ['between']],
]);

/**
 * The ordering operators, with the authoring spellings that lower to each —
 * the four positions of the 2026-09-01 null-comparand refusal (#14080).
 *
 * Same shape and same reason as {@link LIST_COMPARAND_OPERATORS}: the
 * spellings serve the MESSAGE (an author writes `after` on a `ViewFilterRule`
 * and never types `$gt`), they are the `AST_OPERATOR_MAP` keys that map to
 * each operator, spelled here because `filter.zod.ts` imports this module, and
 * `filter-comparand-shape.test.ts` reconciles the two sets so a new ordering
 * spelling cannot land unnamed.
 */
const ORDERING_COMPARAND_OPERATORS: ReadonlyMap<string, readonly string[]> = new Map([
  ['$gt', ['>', 'gt', 'greater_than', 'greaterthan', 'after']],
  ['$gte', ['>=', 'gte', 'greater_than_or_equal', 'greaterthanorequal', 'greaterorequal']],
  ['$lt', ['<', 'lt', 'less_than', 'lessthan', 'before']],
  ['$lte', ['<=', 'lte', 'less_than_or_equal', 'lessthanorequal', 'lessorequal']],
]);

/** What a caller most likely meant when they wrote a scalar. */
const SCALAR_ALTERNATIVE: ReadonlyMap<string, string> = new Map([
  ['$in', '"=" ($eq)'],
  ['$nin', '"!=" ($ne)'],
]);

/**
 * A plain object — filter STRUCTURE rather than a comparand.
 *
 * `Date` and other class instances are comparands even though `typeof` calls
 * them objects, and an array is a comparand at this position too (it is what a
 * list operator is FOR). Same classification `driver-memory`'s gate makes.
 */
function isFilterNode(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && !(value instanceof Date)
  );
}

/**
 * Is `value` shaped like a `{ $field: … }` reference? — the #7596 endpoint
 * carve-out's recogniser.
 *
 * SHAPE only, and the referenced NAME is never consulted, not even its type:
 * the point is to recognise what the author WROTE so the refusal can name it,
 * which has to happen for any `{ $field: … }` and not only for one whose
 * referent would have resolved.
 *
 * Spelled exactly as the schema door's `isFieldReferenceShape`
 * (`./filter.zod.ts`) spells it, rather than imported — `filter.zod.ts`
 * imports THIS module and the reverse edge would be a cycle, the same argument
 * {@link LIST_COMPARAND_OPERATORS} records. ⛔ Deliberately NOT routed through
 * {@link isFilterNode}, whose `Date` arm this predicate does not carry: the
 * two doors then answer identically by construction rather than by argument.
 * `filter-comparand-shape.test.ts` reads both doors on one input set so they
 * cannot drift apart anyway.
 */
function isFieldReferenceShape(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value) && '$field' in value;
}

/** `string` / `number` / `null` / `object` … — the word the message uses. */
function describeOperand(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'Date';
  return typeof value;
}

/**
 * A short, bounded rendering of the offending value.
 *
 * Bounded because the value came off the wire and a filter comparand can be
 * arbitrarily large; the message is for a human reading a 400, not a dump.
 *
 * The whole message has a second, harder bound: `rest-server.ts` TRUNCATES a
 * declared-4xx message at `CLIENT_MESSAGE_MAX` (500) before it reaches the
 * client (#5423). Everything a caller needs in order to act — operator, field,
 * received value, position, corrected shape — is therefore front-loaded, and
 * the test file pins the assembled length under that bound so a later edit
 * cannot silently push the tail off the wire.
 */
function shapePreview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The wire envelope every filter refusal on the platform carries — ADR-0112
 * class 1. See the module note for why the code is a literal here.
 *
 * `context` is the optional caller prefix (`find('deal')`) that carries the
 * engine's refusal-wording contract (#5346); it is the same parameter, in the
 * same position, as {@link normalizeFilterComparandTypes}'s. A spec-level
 * caller with no operation to name passes none, and the message reads from its
 * first load-bearing word.
 */
function invalidFilterComparandError(context: string | undefined, message: string): Error {
  const err = new Error(`${context ? `${context}: ` : ''}${message}`) as Error & {
    code?: string;
    status?: number;
  };
  err.code = 'INVALID_FILTER';
  err.status = 400;
  return err;
}

/**
 * `$in` / `$nin` whose comparand is not a list at all.
 *
 * Names the operator (in both the lowered and the authoring spelling), the
 * field, the received shape, the position, and the expected shape — the #5346 /
 * #5348 wording contract. The closing sentence is the one a caller cannot infer
 * from a status code: the query did not run.
 */
function nonListComparandError(
  context: string | undefined,
  op: string,
  field: string,
  value: unknown,
  path: string,
): Error {
  const spellings = LIST_COMPARAND_OPERATORS.get(op) ?? [];
  const alternative = SCALAR_ALTERNATIVE.get(op);
  return invalidFilterComparandError(
    context,
    `Operator "${op}" on field "${field}" requires an ARRAY of ` +
    `values. Received ${describeOperand(value)} (${shapePreview(value)}) at ${path}. ` +
    `"${op}" tests membership of a list — write ${shapePreview([value])} for a single value` +
    (alternative ? `, or use ${alternative} to compare against it` : '') +
    `. Authoring spellings: ${spellings.join(', ')}. The filter was NOT applied, and an ` +
    `unapplied filter would have returned the UNFILTERED result set.`,
  );
}

/**
 * `$between` whose comparand is not a two-element `[min, max]` array.
 *
 * Arity only — the exact condition `driver-sql`'s `$between` arm and
 * `driver-memory`'s `isBetweenComparand` already apply, hoisted so that the
 * backends which check NEITHER stop answering silently. The leading sentence is
 * kept verbatim from those two so one condition keeps one wording across the
 * platform (#5240's rule, applied across packages rather than within one).
 */
function malformedRangeComparandError(
  context: string | undefined,
  field: string,
  value: unknown,
  path: string,
): Error {
  return invalidFilterComparandError(
    context,
    `Operator "$between" on field "${field}" requires a [min, max] ` +
    `value array. Received ${describeOperand(value)} (${shapePreview(value)}) at ${path}. ` +
    `A range needs exactly two bounds, in order; the authoring spelling that lowers to ` +
    `"$between" is "between". The filter was NOT applied, and an unapplied filter would have ` +
    `returned the UNFILTERED result set.`,
  );
}

/**
 * A `null` MEMBER of a membership list — refused BY RULING, 2026-08-31
 * (#13357); see the module note's "Refused BY RULING" section.
 *
 * The prescription is the ruling's own sentence: absence is stated with the
 * null predicate, explicitly — `$or: [{$in: […]}, {$null: true}]` — never
 * smuggled into a membership list no two backends read alike. The `$nin`
 * author's usual intent ("has a value and it is not one of […]") is the
 * `{$null: false}` half, so both halves are named. Same #5346/#5348 wording
 * contract as {@link nonListComparandError}: operator, field, position,
 * corrected shape, front-loaded; the schema door's twin is
 * `nullListComparandMemberMessage` (`./filter.zod.ts`), reconciled by pin.
 */
function nullListMemberError(
  context: string | undefined,
  op: string,
  field: string,
  index: number,
  path: string,
): Error {
  const spellings = LIST_COMPARAND_OPERATORS.get(op) ?? [];
  return invalidFilterComparandError(
    context,
    `Operator "${op}" on field "${field}" does not accept null as a list member ` +
    `(at ${path}[${index}]). No two backends agree on what it matches; state absence ` +
    `explicitly with the null predicate: {"$or": [{"${field}": {"$in": […]}}, ` +
    `{"${field}": {"$null": true}}]} is "one of […] OR has no value"; {"$null": false} ` +
    `is "has a value". Authoring spellings: ${spellings.join(', ')}. The filter was NOT ` +
    `applied, and an unapplied filter would have returned the UNFILTERED result set.`,
  );
}

/**
 * A `$between` bound that is `null` — the same 2026-08-31 ruling, #13495's
 * shape, folded into this door.
 *
 * Its own message rather than an extension of
 * {@link malformedRangeComparandError}: that one's leading sentence is kept
 * verbatim from `driver-sql`'s and `driver-memory`'s ARITY arms (#5240's
 * one-condition-one-wording rule), and a null bound is a different condition
 * that NO driver refuses — there is no existing wording to share, and welding
 * the new condition onto the arity sentence would misdescribe a well-arity
 * `[null, max]` as "not a [min, max] value array".
 */
function nullRangeBoundError(
  context: string | undefined,
  field: string,
  value: unknown,
  index: number,
  path: string,
): Error {
  return invalidFilterComparandError(
    context,
    `Operator "$between" on field "${field}" requires two non-null bounds. Received null ` +
    `at ${path}[${index}] of ${shapePreview(value)}. A half-open range is "$gte"/"$lte"; ` +
    `"in range OR has no value" is {"$or": [{"${field}": {"$between": [min, max]}}, ` +
    `{"${field}": {"$null": true}}]}. The authoring spelling that lowers to "$between" is ` +
    `"between". The filter was NOT applied, and an unapplied filter would have returned ` +
    `the UNFILTERED result set.`,
  );
}

/**
 * A `$between` bound that is BLANK — the empty string or `undefined`, at
 * either end. Refused BY RULING, 2026-09-20 (#19071); see the module note's
 * third "Refused BY RULING" section.
 *
 * Its own message rather than an arm of {@link nullRangeBoundError}: that one
 * prescribes the null PREDICATE, which is the wrong remedy for a bound the
 * author simply did not type. This one is the schema door's
 * `blankRangeBoundMessage` (`./filter.zod.ts`) carrying the same two
 * prescriptions — write the bound you meant, or, if only one side was ever
 * bounded, drop `$between` for the scalar comparison that says so — in this
 * door's own #5346/#5348 wording contract: operator, field, position, the
 * named side, authoring spellings, front-loaded and inside the 500-char client
 * bound. Reconciled by pin, as the null pair is.
 *
 * The received value is described in WORDS rather than previewed: `undefined`
 * inside an array renders as `null` through `JSON.stringify`, which would show
 * an author the one spelling this message is not about.
 */
function blankRangeBoundError(
  context: string | undefined,
  field: string,
  bound: unknown,
  index: number,
  path: string,
): Error {
  const spellings = LIST_COMPARAND_OPERATORS.get('$between') ?? [];
  return invalidFilterComparandError(
    context,
    `Operator "$between" on field "${field}" requires two non-blank bounds. Received ` +
    `${bound === undefined ? 'undefined' : 'an empty string'} at ${path}[${index}] ` +
    `(the ${index === 0 ? 'MIN' : 'MAX'} bound). A blank endpoint is compared as a value, so ` +
    `the range stops bounding on that side. Write the bound you meant; for a genuinely ` +
    `one-sided range use {"$gte": min} / {"$lte": max}. Authoring spellings: ` +
    `${spellings.join(', ')}. The filter was NOT applied, and an unapplied filter would have ` +
    `returned the UNFILTERED result set.`,
  );
}

/**
 * A `$between` bound that is a `{ $field }` REFERENCE — refused BY RULING,
 * 2026-08-11 (#7596), implemented at this door under #19377; see the module
 * note's fourth "Refused BY RULING" section.
 *
 * Its own message rather than an arm of any of the three above: those
 * prescribe a VALUE (a bound the author did not type, or the null predicate),
 * and the author who wrote a reference was reaching for a column-to-column
 * comparison — a capability the platform HAS, one operator over. The remedy is
 * therefore a different filter, not a different literal, and the message
 * spends its budget saying so.
 *
 * The received reference is NOT previewed. Its position is already named to
 * the index and the side, and the 500-char client bound (#5423) buys more as
 * the two-bound spelling than as an echo of what the author is looking at.
 *
 * The schema door's twin is `listPositionFieldReferenceMessage`
 * (`./filter.zod.ts`), reconciled by pin, as the null and blank pairs are —
 * and like that one it ⛔ does NOT offer the in-memory evaluator as an escape:
 * `matchesFilter` does not resolve a list member either, it fails silently
 * instead of loudly, so naming it would send an author to the one path whose
 * answer is a wrong row set rather than an error.
 */
function fieldReferenceRangeBoundError(
  context: string | undefined,
  field: string,
  index: number,
  path: string,
): Error {
  const spellings = LIST_COMPARAND_OPERATORS.get('$between') ?? [];
  return invalidFilterComparandError(
    context,
    `Operator "$between" on field "${field}" does not accept a { "$field": … } reference as an ` +
    `endpoint (at ${path}[${index}], the ${index === 0 ? 'MIN' : 'MAX'} bound). No evaluation ` +
    `path resolves one inside a list. Write a literal bound, or range column-to-column as two ` +
    `bounds: {"$gte": {"$field": "a"}, "$lte": {"$field": "b"}}. Authoring spellings: ` +
    `${spellings.join(', ')}. The filter was NOT applied, and an unapplied filter would have ` +
    `returned the UNFILTERED result set.`,
  );
}

/**
 * A `null` comparand of `$gt` / `$gte` / `$lt` / `$lte` — refused BY RULING,
 * 2026-09-01 (#14080); see the module note's second "Refused BY RULING"
 * section.
 *
 * The prescription is the ruling's own: `$eq: null` / `$ne: null` ARE the
 * null predicates (#5332), so the refusal names both halves — an author who
 * wrote `$gte: null` was reaching for one of them. Same #5346/#5348 wording
 * contract as {@link nullListMemberError}: operator, field, position,
 * corrected shape, authoring spellings, front-loaded and inside the 500-char
 * client bound; the schema door's twin is `nullOrderingComparandMessage`
 * (`./filter.zod.ts`), reconciled by pin.
 */
function nullOrderingComparandError(
  context: string | undefined,
  op: string,
  field: string,
  path: string,
): Error {
  const spellings = ORDERING_COMPARAND_OPERATORS.get(op) ?? [];
  return invalidFilterComparandError(
    context,
    `Operator "${op}" on field "${field}" does not accept a null comparand (at ${path}). ` +
    `null is not ordered; no two evaluation faces agree on what it matches. State absence ` +
    `with the null predicate: {"$eq": null} is "has no value", {"$ne": null} is "has a value". ` +
    `Authoring spellings: ${spellings.join(', ')}. The filter was NOT applied, and an ` +
    `unapplied filter would have returned the UNFILTERED result set.`,
  );
}

/**
 * Walk one `FilterCondition` and refuse every list-shaped operator whose
 * comparand cannot be one — and, since the two null rulings (2026-08-31,
 * 2026-09-01), the null comparand positions those rulings carved out.
 *
 * Read-only and allocation-free on the overwhelmingly common path (a filter
 * with no list operator walks its own keys and returns). Runs on every engine
 * read and write and inside every {@link parseFilterAST} call, so it stays a
 * walk rather than a schema parse — that cost is now the whole reason, and this
 * gate deliberately enforces only the three list declarations the drivers
 * genuinely cannot agree on, plus the null carve-outs ruled onto the same door.
 *
 * @param node    the LOWERED `FilterCondition` — never the authoring array.
 * @param context optional caller prefix (`find('deal')`), the engine's #5346
 *                wording contract; omitted by spec-level callers.
 * @param path    the key path reported in the refusal, seeded at `where`.
 *
 * [#5685] This paragraph used to carry a second reason: that
 * `FieldOperatorsSchema` was "stricter than the runtime in ways the runtime
 * deliberately allows", because `$gt` was declared `number | Date |
 * FieldReference` while `['created_at', '>', '2026-01-01']` lowers to a STRING
 * bound that every backend accepts and the showcase apps rely on. That was a
 * real mismatch and it is **fixed at the source** rather than tolerated here:
 * the four ordering slots now declare `string` too, so the observation that
 * motivated this note no longer describes the schema. It is recorded rather
 * than deleted because this gate's workaround is part of the evidence that
 * closed #5685 — the schema, not the runtime, was the wrong side.
 */
export function assertListComparandShapes(
  node: unknown,
  context?: string,
  path = 'where',
): void {
  if (!isFilterNode(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = `${path}.${key}`;
    if (key === '$and' || key === '$or') {
      // A non-array operand is a different defect, owned by the drivers'
      // combinator checks; this gate only walks what it can.
      if (Array.isArray(value)) {
        value.forEach((child, index) =>
          assertListComparandShapes(child, context, `${here}[${index}]`));
      }
      continue;
    }
    if (key === '$not') {
      assertListComparandShapes(value, context, here);
      continue;
    }
    // Any other `$` key at node level is a logical operator this gate does not
    // judge — an unknown one is already refused downstream, by name.
    if (key.startsWith('$')) continue;
    assertFieldListComparands(context, key, value, here);
  }
}

/** One field constraint: `{ field: <spec> }`. */
function assertFieldListComparands(
  context: string | undefined,
  field: string,
  spec: unknown,
  path: string,
): void {
  // A spec that is not a plain object is a comparand (implicit equality) and
  // carries no operator to check.
  if (!isFilterNode(spec)) return;
  const keys = Object.keys(spec);
  // No `$` key at all → a deep-equality comparand or a nested-relation
  // condition. Not descended into; see the module note.
  if (!keys.some((key) => key.startsWith('$'))) return;
  for (const op of keys) {
    // The ordering carve-out (2026-09-01 ruling, #14080). Strictly `null`:
    // `undefined` keeps the TYPE door's own sentence, and every other
    // comparand type in these slots is that door's question, not this one's.
    if (ORDERING_COMPARAND_OPERATORS.has(op)) {
      if (spec[op] === null) {
        throw nullOrderingComparandError(context, op, field, `${path}.${op}`);
      }
      continue;
    }
    if (!LIST_COMPARAND_OPERATORS.has(op)) continue;
    const comparand = spec[op];
    if (op === '$between') {
      if (!Array.isArray(comparand) || comparand.length !== 2) {
        throw malformedRangeComparandError(context, field, comparand, `${path}.${op}`);
      }
      // Shape first (a list at all), then the null carve-out (2026-08-31
      // ruling, #13495's shape) — so `$between: null` keeps the arity message
      // it has always had and only a well-arity pair can reach this check.
      const nullBound = comparand.indexOf(null);
      if (nullBound !== -1) {
        throw nullRangeBoundError(context, field, comparand, nullBound, `${path}.${op}`);
      }
      // Then the BLANK carve-out (2026-09-20 ruling, #19071) — exactly the two
      // spellings the schema door refuses as blank, so the two doors answer one
      // question the same way. Strict equality against `''` and `undefined`:
      // ⛔ no trim, because a whitespace-only endpoint PASSES the schema door
      // and narrowing further here would re-open the split in the other
      // direction; and `0` / `'0'` / `false` are endpoints, not blanks.
      const blankBound = comparand.findIndex((bound) => bound === '' || bound === undefined);
      if (blankBound !== -1) {
        throw blankRangeBoundError(
          context, field, comparand[blankBound], blankBound, `${path}.${op}`,
        );
      }
      // Then the `{ $field }` REFERENCE carve-out (2026-08-11 ruling, #7596,
      // reaching this door under #19377) — LAST, so every pair that already
      // carried a refusal keeps the message it had, and only a pair this door
      // accepts today can reach it. Shape, not value: `{ $field: 42 }` is the
      // shape the author wrote and is named as such, one step before the TYPE
      // door would have called it a plain object.
      const referenceBound = comparand.findIndex(isFieldReferenceShape);
      if (referenceBound !== -1) {
        throw fieldReferenceRangeBoundError(context, field, referenceBound, `${path}.${op}`);
      }
      continue;
    }
    if (!Array.isArray(comparand)) {
      throw nonListComparandError(context, op, field, comparand, `${path}.${op}`);
    }
    // The null-member carve-out (2026-08-31 ruling, #13357). `indexOf` is the
    // O(list) pass the door already pays for `$between`'s arity — strict
    // equality, so `undefined`, `''`, `0` and `false` members are untouched,
    // and an EMPTY list never enters the branch (it has no members; `$in: []`
    // / `$nin: []` stay the declared predicates they are).
    const nullMember = comparand.indexOf(null);
    if (nullMember !== -1) {
      throw nullListMemberError(context, op, field, nullMember, `${path}.${op}`);
    }
  }
}
