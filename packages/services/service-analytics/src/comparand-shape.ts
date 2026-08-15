// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which comparand SHAPES this package's filter compilers can express (#5234).
 *
 * Two questions, asked of every value that reaches a predicate:
 *
 *   1. can it become a bound parameter at all ({@link isBindableComparand})?
 *   2. does it have a faithful rendering as the TEXT of a `LIKE` pattern
 *      ({@link isRenderableTextComparand})?
 *
 * They are different questions about the same value — a binary buffer binds
 * fine and renders to nothing meaningful — and they are asked at different
 * operators, so they are two predicates rather than one with a flag.
 *
 * ## Why this file exists at all
 *
 * `driver-sql`'s `applyLike` and this package's {@link likePattern} both reached
 * their comparand through `String(value)`, and `String({})` is the literal
 * `'[object Object]'`. The result was never an error: it was a parameterised,
 * syntactically perfect `LIKE '%[object Object]%'` — a pattern the author never
 * wrote. Measured against a row whose text really is `[object Object]`, that
 * pattern MATCHED it, and `$notContains` EXCLUDED it. The `$in` / `$nin` half is
 * quieter still: an object member binds, compares equal to nothing, and the list
 * silently loses an entry — so `{status: {$nin: [{…}]}}` excludes nothing while
 * claiming to exclude something.
 *
 * ## The fence is an ALLOW-list, and it is measured
 *
 * An allow-list because a deny-list silently re-admits whatever value form is
 * invented next — the lesson `driver-turso`'s `RemoteTransport` wrote down when
 * it refused these same two shapes in remote mode (cloud#1004 / #1058), which is
 * also the precedent this rule follows rather than inventing a second policy.
 *
 * What stays IN the fence was measured across every face before being kept, not
 * assumed:
 *
 * | comparand | `driver-sql` | `driver-memory` | analytics (both doors) |
 * |---|---|---|---|
 * | `{$contains: 5}` | `%5%` | `%5%` | `%5%` |
 * | `{$contains: null}` | `%null%` | no match | `%null%` (#5526 pinned) |
 * | `{$contains: {}}` | matched a row reading `[object Object]` | same | same |
 * | `{$contains: ['al','be']}` | `%al,be%` | — | `%al,be%` (read scope) / `%al%` (`where` door) |
 *
 * The primitives agree, so refusing them would BREAK agreement — #5526 kept
 * `{$contains: 5}` deliberately for exactly that reason. The last row is the
 * opposite case: an array comparand already answered two different ways inside
 * this one package, so refusing it closes a live split.
 *
 * ## [#8186] The TYPE membership is IMPORTED; only the local extras are mirrored
 *
 * These predicates used to restate `driver-sql`'s `isBindableComparand` /
 * `isRenderableTextComparand` in full, because `service-analytics` depends on no
 * driver (see its `package.json` — only `@objectstack/core`,
 * `@objectstack/spec` and `@objectstack/types`) and those are module-private
 * functions with no export to reach for. The set itself no longer needs
 * reaching for: #7872 promoted it to the shared comparand-type door in
 * `@objectstack/spec/data`, `driver-sql` and `driver-turso` consume it there,
 * and since #8186 so does this file — `isAcceptedFilterComparand` for the six
 * types, {@link ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} for the sentence the
 * refusals quote. The old comment's own prescription, applied: "a THIRD
 * hand-copy is the thing to refuse: import from one of the two."
 *
 * What is still mirrored is the part the door deliberately does not carry —
 * each face's LOCAL extras (this package's `undefined` and binary arms), which
 * `driver-sql` records at its own use sites for the same reasons. Those stay
 * held by `__tests__/like-metacharacter-escape.test.ts`, which asserts both
 * predicates against the driver's post-#7872 expressions over a shared value
 * table, and by `__tests__/comparand-door-single-source.test.ts`, which pins the
 * end-to-end accept/refuse matrix this reconciliation had to leave untouched.
 *
 * ⛔ The ENVELOPES and the position logic below are this package's own and were
 * deliberately NOT moved: a caller-authored `where` refuses with a 400
 * `INVALID_FILTER`, a read scope fails closed with a 500 (ADR-0021 D-C), and
 * only the type membership and the shared sentence come from the door.
 *
 * ## ⚠️ [#7598] What the mirror does NOT cover: a position no gate ever reached
 *
 * `{ $field: 'col' }` is the shape the two predicates above are most often
 * assumed to handle, and they do not — not because they drifted, but because
 * they are only ASKED about two of the positions a comparand can sit in. Both
 * still classify a reference object exactly as `driver-sql`'s twins do (an
 * object is neither bindable nor renderable), and both doors call them for the
 * LIKE family and for `$in`/`$nin`/`$between` MEMBERS only. The whole comparand
 * of a scalar comparison — `{ amount: { $gt: { $field: 'budget' } } }` — was
 * asked of neither, so it was BOUND: measured on `origin/main` (`5823d593d`),
 * the read-scope door compiled `"t"."amount" > ?` with the reference OBJECT in
 * the bind list and the analytics `where` door compiled the same predicate with
 * the JSON TEXT `{"$field":"budget"}`. Nothing refused, nothing logged, and the
 * predicate compares a column against a value no row can hold.
 *
 * That is why this file gained a THIRD question — {@link isFieldReference} —
 * rather than a widened answer to the first two: the defect was never a
 * misclassification, so tightening `isBindableComparand` would have changed
 * cells that were already right (and broken the mirror) while leaving the
 * unasked position unasked.
 *
 * ## …and what the answer to that question is now — maintainer ruling 2026-08-12
 *
 * #7694 stopped the bind by REFUSING the shape on both doors, as the shipped
 * interim while the routing question sat with the maintainer. The ruling (Q1 =
 * B) replaced that with routing: `NativeSQLStrategy.canHandle` DECLINES a query
 * whose `where` or read scope carries a scalar reference, the query falls
 * through to the ObjectQL/engine path, and `driver-sql` compiles the comparison
 * under the four #5222 rulings using the `initObjects` metadata it owns. The
 * capability is therefore AVAILABLE on the analytics face, and the four security
 * rulings live in exactly one place — the option-A alternative (a
 * `StrategyContext` enumeration hook plus a second copy of those rulings here)
 * was rejected precisely because a guard that exists twice is a guard that will
 * disagree with itself.
 *
 * What this file contributes to that is {@link findCrossFieldComparand}, the
 * routing predicate, alongside the two refusal sentences that survive it:
 * {@link fieldReferenceComparandMessage} for the `/analytics/sql` echo, which
 * cannot honestly RENDER a predicate it does not emit, and
 * {@link fieldReferenceBetweenBoundMessage} for a `$between` endpoint, which no
 * backend serves and which #7596 removed from the spec.
 */

import {
  isAcceptedFilterComparand,
  ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE,
} from '@objectstack/spec/data';

/**
 * Can this value be handed to a driver as a bound parameter at all?
 *
 * [#8186] The TYPE membership is the shared comparand-type door's
 * (`isAcceptedFilterComparand`, `@objectstack/spec/data`), not this file's. It
 * used to be spelled out here, and identically again in
 * {@link isRenderableTextComparand} — three copies of one six-type set counting
 * the door itself, which is the drift risk #8186 was filed on rather than a
 * defect: the copies AGREED with the door, cell for cell, right up to this
 * change (`__tests__/comparand-door-single-source.test.ts` measured the whole
 * matrix on `origin/main` first, then re-ran it unchanged after).
 *
 * `driver-sql`'s twin was reconciled the same way by #7872 and this mirrors its
 * post-#7872 spelling, so the two are still a value-for-value mirror — see the
 * "Mirrored, not imported" section above, whose subject is now the LOCAL EXTRAS
 * rather than the set.
 *
 * ## The one package-local extra here: binary
 *
 * `ArrayBuffer.isView` (which covers `Buffer`, a `Uint8Array`) is a bindable the
 * engine-level door does not admit, and it is deliberately kept: a blob column
 * really is comparable on this driver family, and the read path measured it
 * accepted in every bind position. It is `driver-sql`'s own recorded extra too.
 */
export function isBindableComparand(value: unknown): boolean {
  // `undefined` — see {@link isRenderableTextComparand}'s note; it is admitted
  // here for the same reason and is just as unreachable through either door.
  if (value === undefined) return true;
  return isAcceptedFilterComparand(value) || ArrayBuffer.isView(value);
}

/**
 * Does this value have a faithful rendering as the text of a `LIKE` pattern?
 *
 * [#8186] The bindable set minus binary — and, like its sibling, the six-type
 * membership is now the shared door's (`isAcceptedFilterComparand`,
 * `@objectstack/spec/data`) rather than a local re-spelling. Binary binds but
 * renders to nothing a caller meant, which is why the two questions are two
 * predicates rather than one with a flag.
 *
 * ## The package-local extra here: `undefined` — kept, and unreachable
 *
 * `undefined` is inside the fence because it is not authorable (JSON has no
 * `undefined`) and `filter-normalizer.ts`'s `comparand()` normalises it to
 * `null` rather than refusing it (#5526, #5332).
 *
 * ⚠️ It no longer REACHES either predicate from either door, and the two
 * refusals arrived separately:
 *
 * | door | what refuses an `undefined` comparand first | envelope |
 * |---|---|---|
 * | read scope | `read-scope-sql.ts`, per #6050 ruling B pushed down by #6125 | `READ_SCOPE_COMPILE_FAILED` / 500 |
 * | analytics `where` | `assertDefinedComparands` (#6386, same ruling) | `INVALID_FILTER` / 400 |
 *
 * So `comparand()`'s normalise-to-`null` is itself a deliberately-kept dead arm
 * (its own TSDoc says so, and says reopening it is #5526's call, not a
 * cleanup's) — and this branch is one too. ⛔ Neither is evidence that this
 * package TOLERATES `undefined` where the shared door refuses it: measured
 * through both doors, `undefined` is REFUSED here exactly as the door would
 * refuse it (`__tests__/comparand-door-single-source.test.ts` pins that row at
 * both doors, in all three comparand positions). The branch stays because these
 * predicates are a value-for-value mirror of `driver-sql`'s twins, which keep
 * theirs for the identical reason — refused upstream there too, since #6050.
 * Narrowing the fence here would break the mirror without removing a reachable
 * answer.
 */
export function isRenderableTextComparand(value: unknown): boolean {
  return value === undefined || isAcceptedFilterComparand(value);
}

/**
 * [#7598] Is this comparand a `{ $field: 'col' }` reference — the shape
 * `FieldReferenceSchema` declares and `compileCelToFilter` really produces for a
 * field-to-field comparison in a CEL permission / RLS rule?
 *
 * Character for character `driver-sql`'s module-private `fieldReferenceOf`
 * (`sql-driver.ts`), read as a boolean: a plain object, not an array, carrying a
 * `$field` whose value is a STRING. Two deliberate consequences of mirroring
 * that spelling rather than inventing a third:
 *
 *   - **Extra keys do not disqualify it.** `{ $field: 'budget', extra: 1 }` IS a
 *     reference on all three faces, because `@objectstack/formula`'s
 *     `resolveValue` reads `'$field' in raw` and ignores the remainder. A
 *     narrower reading here would let the remainder be re-bound as a literal on
 *     one face and resolved on another — the split this whole file exists to
 *     close (#5222 measured the same cell driver-side and moved its own test).
 *   - **A non-string `$field` is NOT one.** `{ $field: 5 }` falls through to the
 *     ordinary object-comparand account — `driver-sql` binds it as JSON there
 *     and so does this package (#5234 left `{$eq: {…}}` alone on purpose). That
 *     cell is untouched here; changing it would be a different ruling, not a
 *     rider on this one.
 *
 * ⚠️ `@objectstack/formula` is the WIDER of the two (`'$field' in raw`, any
 * value type). The driver's spelling is mirrored because this file's contract is
 * to be a value-for-value mirror of `driver-sql`, and because the wider reading
 * would refuse a shape the drivers bind — a new divergence in a change that
 * exists to remove one.
 */
export function isFieldReference(value: unknown): value is { $field: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return typeof (value as Record<string, unknown>).$field === 'string';
}

/**
 * [#7598] The comparison operators whose whole comparand `driver-sql` compiles
 * into a same-table column-to-column comparison since #5222 — and exactly the
 * positions where a `{ $field }` silently BOUND on this package's two doors.
 *
 * A mirror of `driver-sql`'s module-private `CROSS_FIELD_COMPARISON_OPERATORS`,
 * held by `__tests__/cross-field-reference-refusal.test.ts` rather than by this
 * comment: that suite drives the SHARED corpus (`CROSS_FIELD_CASES`, exported
 * from `@objectstack/driver-sql` precisely so a second face can be held to the
 * same table), so an operator the driver starts or stops compiling shows up as a
 * corpus case this package answers differently.
 *
 * Every OTHER position a reference can occupy was already refused on both doors
 * and is deliberately left alone, wording included — the LIKE family through
 * {@link isRenderableTextComparand}, `$in` / `$nin` members through
 * {@link isBindableComparand}, and a bare `{ field: { $field: … } }` as an
 * unsupported operator. Those refusals CONVERGE with `driver-sql`, which refuses
 * the same positions in its own #5222 refusal arm; only this set diverged.
 */
export const CROSS_FIELD_COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
]);

/**
 * [#7598, maintainer ruling 2026-08-12 Q1 = B] The first `{ $field }` reference
 * sitting in a position `driver-sql` COMPILES since #5222 — or `null`.
 *
 * ## What this is FOR, which is not what the two predicates above are for
 *
 * {@link isBindableComparand} and {@link isRenderableTextComparand} answer
 * "may this ONE value reach that ONE position". This walks a WHOLE filter —
 * an analytics `where` (already lowered by `lowerAnalyticsWhere`, so the
 * authored array sugar arrives here as a `FilterCondition`) or an RLS read
 * scope — and answers a routing question instead: **does serving this query
 * require the cross-field capability?** `NativeSQLStrategy.canHandle` reads it
 * to DECLINE, so the query falls through to the ObjectQL/engine path, where
 * `driver-sql` compiles the comparison and enforces the four #5222 rulings
 * with the `initObjects` metadata it owns. See that method for the ruling.
 *
 * ## Why only the six scalar operators, when the ruling says "carries `$field`"
 *
 * Every OTHER position a reference can occupy is refused IDENTICALLY on both
 * sides of the routing decision — the LIKE family and `$in` / `$nin` members
 * through this file's two predicates here and through `driver-sql`'s own #5222
 * refusal arm, a `$between` endpoint through
 * `filter-normalizer.ts`'s surviving gate, a bare `{ field: { $field: … } }` as
 * an unsupported operator. Declining for those would swap one refusal for
 * another refusal a package further away, trading this package's precise
 * wording for the driver's without changing a single outcome. The scalar
 * comparands are the whole of what routing BUYS, so they are the whole of what
 * it tests.
 *
 * The walk is structural and total: it descends into `$and` / `$or` arrays,
 * `$not` operands, nested relation objects and any other nesting, because a
 * reference three combinators deep still needs the engine path. It is
 * deliberately blind to whether the referenced column is DECLARED, is the
 * tenant column, or has a comparable type — those are the four rulings, they
 * live in exactly one place (`driver-sql`), and re-asking them here is the
 * duplicated-guard the ruling rejected as option A.
 */
export function findCrossFieldComparand(
  filter: unknown,
): { op: string; field: string; ref: string } | null {
  return findIn(filter, '');
}

function findIn(
  node: unknown,
  field: string,
): { op: string; field: string; ref: string } | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findIn(child, field);
      if (hit) return hit;
    }
    return null;
  }
  if (node instanceof Date || ArrayBuffer.isView(node)) return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (CROSS_FIELD_COMPARISON_OPERATORS.has(key) && isFieldReference(value)) {
      return { op: key, field, ref: value.$field };
    }
    // A `$`-prefixed key is an operator or a combinator, so the FIELD in scope
    // does not change; anything else names a field (or a nested relation
    // member) and becomes the new scope. Only used for the message.
    const hit = findIn(value, key.startsWith('$') ? field : key);
    if (hit) return hit;
  }
  return null;
}

/**
 * The Filter Protocol operators whose comparand becomes the text of a `LIKE`
 * pattern — the ones every compiler in this package routes through
 * {@link likePattern}.
 *
 * `$regex` is absent because this package's operator vocabulary does not carry
 * it: `MONGO_TO_CUBE_OP` has no entry and `read-scope-sql` refuses it by name.
 * (`driver-sql` DOES list it, because the better-auth adapter emits it there for
 * a substring search.)
 *
 * [#7693] `$icontains` belongs here for the same reason its four siblings do,
 * and was missing for the ordinary reason a set goes stale: the operator
 * arrived AFTER the fence. #6520 added it to `MONGO_TO_CUBE_OP` and gave
 * `read-scope-sql`'s arm its `assertRenderableText` call, but not this entry —
 * so the analytics `where` door, this set's only reader, applied NO
 * comparand-shape gate to it at all. Measured on `origin/main` @ `b54aaab`:
 *
 * | door | `{name: {$icontains: {foo: 1}}}` |
 * |---|---|
 * | analytics `where` | compiled — `NativeSQLStrategy` bound `'%[object Object]%'` into its `LIKE` |
 * | `read-scope-sql` | REFUSED (`READ_SCOPE_COMPILE_FAILED` / 500) |
 *
 * One operator, two answers inside one package — #5234's defect verbatim, at
 * the operator its fence was never extended to. The ASCII fold `$icontains`
 * adds rides ON TOP of the pattern text (`likeShape` maps it to `'contains'`
 * on both executing compilers), so the question this set asks of a comparand
 * is the same question and the answer had no business differing. `driver-sql`'s
 * own `TEXT_PATTERN_OPERATORS` has listed it since #6520; this entry closes the
 * third and last face, after #7158 closed the objectql `having` one.
 */
export const TEXT_PATTERN_OPERATORS: ReadonlySet<string> = new Set([
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
]);

/** A short, non-throwing rendering of an offending comparand for a message. */
export function shapePreview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return typeof value;
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return typeof value;
  }
}

/**
 * The sentence both doors say about an object where a `LIKE` pattern's text
 * belongs, so the analytics `where` door and the read-scope lowering do not
 * describe one rule two ways. Each door wraps it in its OWN envelope — a 400
 * `INVALID_FILTER` for a caller-authored filter, a fail-closed compile refusal
 * for a read scope — because the envelope is what differs between them, not the
 * diagnosis.
 */
export function unrenderableTextComparandMessage(op: string, field: string, value: unknown): string {
  return (
    `"${op}" on "${field}" matches against the TEXT of a pattern, but its comparand is ` +
    `${Array.isArray(value) ? 'an array' : 'an object'} (${shapePreview(value)}). filter.zod.ts ` +
    `declares it a string (StringOperatorSchema); ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} is ` +
    `accepted. Refusing rather than stringifying it: String({}) is "[object Object]", so the ` +
    `pattern that ran would be one nobody wrote — and a row storing that literal text matches it.`
  );
}

/**
 * [#7598] What `read-scope-sql` says about a `{ $field }` comparand it cannot
 * lower — the ONE surviving caller of this sentence after the 2026-08-12 ruling,
 * and the reason it now reads as a RENDERING boundary rather than a capability
 * one.
 *
 * ## What changed under the ruling, and why the wording had to follow
 *
 * Until that ruling this sentence was said by both doors and meant "the platform
 * will not serve this here". It no longer means that. Q1 = B routes a query
 * whose `where` or read scope carries a reference to the ObjectQL/engine path,
 * where `driver-sql` compiles the comparison and enforces the four #5222 rulings
 * with metadata it owns — so `/analytics/query` SERVES these queries and returns
 * rows. What is left is `compileScopedFilterToSql`, and the caller that still
 * reaches it with such a scope is `ObjectQLStrategy.generateSql`: the
 * `/analytics/sql` ECHO, a display string for an execution it does not perform.
 * There is no honest rendering of a total column-to-column predicate available
 * to that renderer, and the ruling's answer for the echo was explicit —
 * 「一致的响亮答案,不半渲染」 (one consistent, loud answer; no half-rendering).
 *
 * So the message tells a reader three things it could not tell them before: the
 * query itself is fine, the ECHO is what declined, and the rows are one call
 * away on `/analytics/query`. Telling them instead to "compare against a literal"
 * would send them to repair a rule that works.
 *
 * It still names what USED to happen, because that is the part a reader cannot
 * reconstruct: the reference was BOUND. The predicate was syntactically perfect,
 * the query ran, and a column was compared against a value no row can hold — no
 * error, no log line, an admin's read scope quietly answering the wrong row set.
 * That is the #3650 / #5234 class, and naming it is what stops the next reader
 * from "restoring" the old tolerance as a convenience.
 *
 * ⛔ `position` is no longer passed by any caller for a `$between` endpoint —
 * that arm says {@link fieldReferenceBetweenBoundMessage} instead, because it is
 * refused permanently and everywhere rather than declined by one renderer. The
 * parameter stays for a caller that needs to locate a reference inside a nested
 * scope.
 */
export function fieldReferenceComparandMessage(
  op: string,
  field: string,
  ref: string,
  position?: string,
): string {
  return (
    `"${op}" on "${field}"${position ? ` (${position})` : ''} compares against the field reference ` +
    `{ "$field": "${ref}" }, which this compiler does not lower into a column-to-column ` +
    `comparison. Refusing rather than binding it: the reference object used to become the BOUND ` +
    `VALUE of the comparison, so the emitted predicate compared "${field}" against the reference ` +
    `itself — a value no row can hold — and a read scope built from it answered the wrong row set ` +
    `with nothing to read. ⚠️ This is NOT the platform declining the rule. @objectstack/spec ` +
    `declares this shape (FieldReferenceSchema), @objectstack/formula resolves it per record in ` +
    `memory, driver-sql / driver-sqlite-wasm compile it to a same-table column comparison for the ` +
    `six scalar operators since #5222, and since the 2026-08-12 ruling on #7598 the analytics ` +
    `native-SQL strategy DECLINES such a query so it routes to the ObjectQL engine path and runs ` +
    `there — the driver enforcing declared-only enumeration, the tenant-isolation ban and the ` +
    `comparison class with metadata it owns. What refuses here is this SQL lowering, whose only ` +
    `remaining caller is the /analytics/sql display echo; it has no faithful rendering of the ` +
    `predicate the engine path actually runs, and half-rendering one would describe a query that ` +
    `returns different rows. Run the query itself (/analytics/query) to get its rows (#7598).`
  );
}

/**
 * [#7598] A `{ $field }` in a `$between` ENDPOINT — a separate sentence from
 * {@link fieldReferenceComparandMessage} because it is a separate condition,
 * and #5240's rule cuts the other way here: two shapes with two repairs must
 * not share one wording.
 *
 * The scalar comparands above are SERVED, one path over. A `$between` endpoint
 * is not served anywhere and is not going to be: `driver-sql` and
 * `driver-sqlite-wasm` refuse it (`CROSS_FIELD_REFUSALS` pins both endpoints),
 * the memory evaluator has no reading of it either — `resolveValue` returns an
 * array unchanged, so the bounds are ordered against the raw reference OBJECT —
 * and #7596 removed the position from `FieldReferenceSchema` outright under
 * ADR-0049 declared = enforced (maintainer ruling 2026-08-11). Pointing that
 * author at the engine path would point them at another refusal.
 *
 * It matters most on THIS door, which is why the arm exists here at all: the
 * analytics `where` lowering splits `$between` into a `gte` leaf and an `lte`
 * leaf, so an endpoint reference would reach the driver wearing an operator
 * #5222 COMPILES — succeeding on the analytics face alone, in defiance of both
 * the driver corpus and the schema. See `filter-normalizer.ts`'s
 * `assertNoFieldReferenceComparand`.
 */
export function fieldReferenceBetweenBoundMessage(
  op: string,
  field: string,
  ref: string,
  index: number,
): string {
  return (
    `"${op}" on "${field}" has the field reference { "$field": "${ref}" } at index ${index} of its ` +
    `[min, max] bounds. A range BOUND may not be a field reference on any backend: driver-sql and ` +
    `driver-sqlite-wasm refuse both endpoints (#5222), @objectstack/formula does not resolve a ` +
    `reference inside a list either — it orders the bounds against the raw reference object, which ` +
    `no value compares meaningfully to — and @objectstack/spec no longer declares the position at ` +
    `all (#7596 removed FieldReferenceSchema from the $between endpoint union, ADR-0049 declared = ` +
    `enforced). Refusing rather than lowering it: this compiler splits $between into its two ` +
    `bounds, so the reference would arrive at the driver under a "$gte" / "$lte" the author never ` +
    `wrote — a position the SQL drivers DO compile — and the range would quietly succeed here ` +
    `while the identical filter is refused everywhere else. Use a literal bound, or spell the ` +
    `comparison you meant as a scalar one ({ "${field}": { "$gte": { "$field": "${ref}" } } }), ` +
    `which IS served — on the ObjectQL engine path, where the driver enforces the #5222 rulings ` +
    `(#7598).`
  );
}

/**
 * The sentence both doors say about a list member that cannot be bound. See
 * {@link unrenderableTextComparandMessage} for why the message is shared and the
 * envelope is not.
 *
 * [#8186] The accepted-set clause is {@link ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE},
 * with binary kept as this package's own parenthetical extra — the exact shape
 * `driver-sql`'s twin took when #7872 reconciled it, so the two faces describe
 * one rule in one wording again. The hand-copy it replaces read "a string,
 * number, boolean, null, Date or binary value", which had silently gone WRONG
 * in the quieter direction: it omitted `bigint`, a type both predicates here
 * have always accepted and both doors have always compiled. Quoting the door
 * fixes the omission as a side effect of removing the copy — the accepted set
 * itself does not move (`__tests__/comparand-door-single-source.test.ts`).
 */
export function unbindableListMemberMessage(
  op: string,
  field: string,
  value: unknown,
  index: number,
): string {
  return (
    `"${op}" on "${field}" has a value at index ${index} of its list that cannot be bound as a SQL ` +
    `parameter: ${shapePreview(value)}. Every member of an $in/$nin/$between list is a comparand ` +
    `in its own right — use ${ACCEPTED_FILTER_COMPARAND_TYPES_SENTENCE} (or a binary value). ` +
    `Refusing rather than binding it: the member can equal no stored value, so the list silently ` +
    `loses that entry (and a $nin loses the exclusion the caller wrote).`
  );
}
