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
 * ## Mirrored, not imported — and held by a test
 *
 * These predicates restate `driver-sql`'s `isBindableComparand` /
 * `isRenderableTextComparand` (`packages/drivers/driver-sql/src/sql-driver.ts`)
 * for the same reason `like-pattern.ts` restates its escape expression:
 * `service-analytics` depends on no driver (see its `package.json` — only
 * `@objectstack/core` and `@objectstack/spec`), and those are module-private
 * functions with no export to reach for. What stops the two from drifting is not
 * these comments but `__tests__/like-metacharacter-escape.test.ts`, which asserts
 * both predicates against a mirrored copy of the driver's expressions over a
 * shared value table. A THIRD hand-copy is the thing to refuse: import from one
 * of the two, or add a consumer to that test.
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
 * unasked position unasked. See {@link fieldReferenceComparandMessage} for what
 * the two doors now say there, and why they say it instead of compiling the
 * comparison the SQL drivers compile since #5222.
 */

/**
 * Can this value be handed to a driver as a bound parameter at all?
 *
 * Character for character the classification `driver-sql`'s
 * `isBindableComparand` applies. (`ArrayBuffer.isView` covers `Buffer`, which is
 * a `Uint8Array`.)
 */
export function isBindableComparand(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
  return value instanceof Date || ArrayBuffer.isView(value);
}

/**
 * Does this value have a faithful rendering as the text of a `LIKE` pattern?
 *
 * The bindable set minus binary, which binds but renders to nothing a caller
 * meant. `undefined` is inside the fence because it is not authorable (JSON has
 * no `undefined`) and {@link comparand} already normalises it to `null` rather
 * than refusing it (#5526, #5332) — refusing it here would invent a
 * disagreement instead of closing one.
 *
 * ⚠️ [#6125] `undefined` no longer REACHES either predicate from the read-scope
 * door: `read-scope-sql.ts` refuses a comparand-position `undefined` upstream of
 * both, per #6050's ruling B pushed down by #6125. The branch stays because
 * these two predicates are a value-for-value mirror of `driver-sql`'s twins
 * (held by `__tests__/like-metacharacter-escape.test.ts`), and those keep it for
 * exactly the same reason — refused upstream there too, since #6050. Narrowing
 * the fence here would break the mirror without removing a reachable answer.
 * The `where` door is unaffected either way: {@link comparand} still normalises
 * `undefined` to `null` before either predicate sees it.
 */
export function isRenderableTextComparand(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
  return value instanceof Date;
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
 * The Filter Protocol operators whose comparand becomes the text of a `LIKE`
 * pattern — the ones every compiler in this package routes through
 * {@link likePattern}.
 *
 * `$regex` is absent because this package's operator vocabulary does not carry
 * it: `MONGO_TO_CUBE_OP` has no entry and `read-scope-sql` refuses it by name.
 * (`driver-sql` DOES list it, because the better-auth adapter emits it there for
 * a substring search.)
 */
export const TEXT_PATTERN_OPERATORS: ReadonlySet<string> = new Set([
  '$contains', '$notContains', '$startsWith', '$endsWith',
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
    `declares it a string (StringOperatorSchema); a string, number, boolean, null or Date is ` +
    `accepted. Refusing rather than stringifying it: String({}) is "[object Object]", so the ` +
    `pattern that ran would be one nobody wrote — and a row storing that literal text matches it.`
  );
}

/**
 * [#7598] The sentence both doors say about a `{ $field }` comparand they do not
 * compile — shared for the same reason {@link unrenderableTextComparandMessage}
 * is, and with the same split: one diagnosis, two envelopes.
 *
 * ## What it has to say that the other two do not
 *
 * The other refusals in this file answer a shape that is wrong everywhere. This
 * one answers a shape that is RIGHT somewhere: since #5222 `driver-sql` and
 * `driver-sqlite-wasm` compile exactly this comparand into a same-table
 * column-to-column comparison, and `@objectstack/formula`'s
 * `matchesFilterCondition` has always resolved it in memory. So the author is
 * not told "this is nonsense" — they are told WHICH face declined and why, which
 * is the difference between an authoring mistake and a platform boundary.
 *
 * It also names what used to happen, because that is the part a reader cannot
 * reconstruct: the reference was BOUND. The predicate was syntactically perfect,
 * the query ran, and a column was compared against a value no row can hold — no
 * error, no log line, an empty chart or a read scope quietly answering the wrong
 * row set. That is the #3650 / #5234 class, and naming it is what stops the next
 * reader from "restoring" the old tolerance as a convenience.
 *
 * ## Why the reason is a MISSING ENUMERATION and not a missing emitter
 *
 * The SQL is trivial — two identifiers and an operator. What these two compilers
 * do not have is the four things #5222's maintainer rulings (2026-08-06) require
 * before a name may enter a SQL identifier position: the object's DECLARED field
 * set, its declared TYPES (for the same-comparison-class rule), its
 * tenant-isolation column (forbidden on both sides), and whether the table is
 * federated. `driver-sql` reads all four out of its own `initObjects` capture;
 * `StrategyContext` (`@objectstack/spec/contracts`) exposes none of them, so
 * these compilers cannot enforce the rulings and refuse rather than ship a
 * weaker port of them. Implementing it here is therefore a `packages/spec`
 * surface question first — tracked on #7598.
 */
export function fieldReferenceComparandMessage(
  op: string,
  field: string,
  ref: string,
  position?: string,
): string {
  return (
    `"${op}" on "${field}"${position ? ` (${position})` : ''} compares against the field reference ` +
    `{ "$field": "${ref}" }, which this compiler does not compile into a column-to-column ` +
    `comparison. Refusing rather than binding it: the reference object used to become the BOUND ` +
    `VALUE of the comparison, so the emitted predicate compared "${field}" against the reference ` +
    `itself — a value no row can hold — and returned a wrong row set with nothing to read. ` +
    `@objectstack/spec declares this shape (FieldReferenceSchema) and it IS executed elsewhere: ` +
    `@objectstack/formula resolves it per record in memory, and driver-sql / driver-sqlite-wasm ` +
    `compile it to a same-table column comparison for the six scalar operators since #5222. It is ` +
    `refused HERE because the #5222 rulings admit a referenced column name into SQL only after ` +
    `checking it against the object's declared fields, their declared types, and its ` +
    `tenant-isolation column — none of which this compiler can see (StrategyContext exposes no ` +
    `such hook), so enforcing them is impossible and skipping them would open a comparison ` +
    `surface onto the tenant boundary. Compare against a literal value here, or route the query ` +
    `through the ObjectQL engine path, whose driver does the enforcing (#7598).`
  );
}

/**
 * The sentence both doors say about a list member that cannot be bound. See
 * {@link unrenderableTextComparandMessage} for why the message is shared and the
 * envelope is not.
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
    `in its own right — use a string, number, boolean, null, Date or binary value. Refusing rather ` +
    `than binding it: the member can equal no stored value, so the list silently loses that entry ` +
    `(and a $nin loses the exclusion the caller wrote).`
  );
}
