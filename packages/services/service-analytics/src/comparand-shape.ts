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
 */
export function isRenderableTextComparand(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const kind = typeof value;
  if (kind === 'string' || kind === 'number' || kind === 'bigint' || kind === 'boolean') return true;
  return value instanceof Date;
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
