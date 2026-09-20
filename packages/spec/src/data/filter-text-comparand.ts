// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18113] The Filter Protocol's **text-comparand door** for the
 * case-insensitive contains operator — WHICH comparands are refused, and WHAT
 * the author is told, published once by the owner of the rule.
 *
 * ## The ruling this executes (objectui#9048 batch #133 item 1, option D)
 *
 * > **D — lift the predicate to the contract's owner.** `@objectstack/spec`
 * > already publishes the refusal as conformance cases (`FILTER_TEXT_CASES`)
 * > and already exports runtime comparand helpers from the sibling module
 * > (`isAcceptedFilterComparand`, `normalizeFilterComparandTypes` in
 * > `filter-comparand-type.ts`, both re-exported by
 * > `packages/spec/src/data/index.ts`). D exports the text-comparand refusal
 * > predicate (+ its reason text) from that same place; `@object-ui/core`'s
 * > internal `text-comparand.ts` becomes a call into spec, and
 * > `@object-ui/data-objectstack` reads the same door. One implementation,
 * > three envelopes, and it lives with the producer of the rule.
 *
 * ## The CONTRACT half only — the envelope is each face's own
 *
 * {@link FILTER_TEXT_CASES} declares two REJECTION rows for this operator (an
 * empty comparand and a non-string one), each with `code: 'INVALID_FILTER'` and
 * `mustMention: ['$icontains']`. This module publishes the half those rows are
 * about — the discrimination and the reason text — and deliberately publishes
 * nothing about how a face DELIVERS it. That split is the half that transfers
 * and the half that does not: a matcher deciding about one ROW has a row to
 * exclude and excludes-and-logs; a producer deciding whether to send a query at
 * all has none and throws. Three shipped faces already prove the split
 * (objectui#8748, objectui#9001, objectui#9152).
 *
 * ⛔ **No new error code.** `INVALID_FILTER` is the declared code for both rows
 * and is already in the ADR-0112 ledger; a face seats this reason inside that
 * envelope rather than minting a second one.
 *
 * ## The message bytes are load-bearing, not stylistic
 *
 * `mustMention` is what makes that true: a differently-worded refusal is a
 * different failure to honour the same row. The text here is the text two
 * objectui faces have shipped byte for byte since objectui#8748 — this module is
 * where the shared bytes MOVED to, not a rewording of them. ⛔ Change them only
 * by changing the rows they answer.
 *
 * ## Scope: the case-insensitive contains operator, and nothing by analogy
 *
 * Only that operator, because only that operator is what the published table
 * declares. The sibling positive operators (`$contains` / `$startsWith` /
 * `$endsWith`) have no such row and keep the answer they have always given on
 * every face — widening by analogy is the table's decision, not this module's.
 *
 * @see FILTER_TEXT_CASES — the two REJECTION rows this door answers.
 * @see filter-comparand-type.ts — the sibling runtime door, same placement precedent.
 * @see https://github.com/objectstack-ai/objectstack/issues/18113 (this module)
 * @see https://github.com/objectstack-ai/objectui/issues/9048 (the ruling)
 */

/**
 * A comparand as it appears INSIDE a refusal message.
 *
 * `JSON.stringify` alone is not safe here even though it is what the message
 * wants: it THROWS on a BigInt and on a cyclic object. Both shipped face-shapes
 * are hurt by that and in mirror-image ways, which is why the guard travels with
 * the text rather than being re-derived per face. On a THROWING face the call
 * sits inside the `throw` expression, so a `TypeError` raised while the message
 * is being built escapes in the refusal's place — and a caller classifying a
 * bare `TypeError` as a transport fault would tell the author to check their
 * connection about a filter this layer had already judged. On an
 * EXCLUDE-AND-LOG face a refusal that throws while explaining itself turns the
 * one path that stays quiet about a bad filter into the one path that takes the
 * caller down.
 *
 * No JSON-sourced filter can carry either shape, so this is about the in-memory
 * callers who hand a literal to a matcher or to a query producer.
 * `?? String(target)` keeps `undefined` and a symbol readable — `JSON.stringify`
 * returns `undefined` for both.
 *
 * ⚠️ Deliberately NOT exported from this module, and therefore not from the
 * package entry: #18113 declared TWO new exported symbols and this is the
 * helper that travels with the second one. This is the place that decision gets
 * recorded rather than a ban — a face that needs to describe a comparand in its
 * OWN envelope text is a published-surface addition, so export it in the PR
 * that needs it and say so, instead of letting it arrive as a side effect.
 */
function describeComparand(target: unknown): string {
  try {
    return JSON.stringify(target) ?? String(target);
  } catch {
    return String(target);
  }
}

/**
 * Is this comparand one of the two shapes {@link FILTER_TEXT_CASES} declares
 * REFUSED for the case-insensitive contains operator?
 *
 * The discrimination, not a re-reading of it: `typeof target !== 'string'`
 * answers the "a non-string $icontains comparand is REFUSED" row and
 * `target === ''` answers the "an empty $icontains comparand is REFUSED" row.
 * It is written once so a face cannot drift into judging a slightly different
 * set — the failure mode that produced the ruling, where the same authored
 * filter was refused in one dialect and lowered onto the wire in another.
 *
 * ⚠️ It answers `true` for `undefined`, which is a carve-out a caller owns
 * rather than a third row: a vocabulary with an "absent" the `$` dialect does
 * not have (a stored view rule whose operator takes no comparand) must test for
 * absence BEFORE asking this question, or it will refuse a valueless operator
 * the table says nothing about.
 *
 * @param target - The comparand as it arrived, unnormalised.
 * @returns `true` for exactly the two declared REJECTION shapes.
 */
export function isRefusedTextComparand(target: unknown): boolean {
  return typeof target !== 'string' || target === '';
}

/**
 * The REASON a case-insensitive-contains comparand is refused — the half of the
 * message the CONTRACT owns, with no face's envelope on it.
 *
 * Returned **without a leading capital and without a trailing period** so each
 * face can seat it in its own sentence: an excluding matcher logs
 * `…: <reason>. Rows are excluded…`, a throwing producer raises
 * `[Face] The <reason>. <tail>`. Those seatings are what objectui#8748 and
 * objectui#9001 already shipped, byte for byte.
 *
 * ⚠️ `operator` is the spelling that **ACTUALLY ARRIVED**, never a canonical one
 * substituted for it — `$icontains` from a `$`-dialect filter, `icontains` from
 * the infix/view vocabulary. Telling an author about a spelling their dialect
 * cannot contain sends them looking for a key their metadata has no way to
 * write.
 *
 * ⚠️ **Consequence a face must seat, measured:** `mustMention: ['$icontains']`
 * is spelled in the `$` dialect because the published rows' filters are. When
 * the arriving spelling is the infix `icontains`, this reason names what
 * arrived and therefore does NOT contain the `$`-dialect token; the face that
 * serves that vocabulary NAMES the `$` twin in its own tail instead
 * (objectui#9152 does exactly this). The contract half cannot do it for them
 * without prescribing a spelling the author's dialect does not have.
 *
 * @param field - The field the condition is on, as authored.
 * @param operator - The operator spelling that ARRIVED — never a substitute.
 * @param target - The refused comparand, as it arrived.
 * @returns The reason clause, uncapitalised and unterminated.
 */
export function textComparandRefusalReason(
  field: string,
  operator: string,
  target: unknown,
): string {
  const declared =
    `@objectstack/spec's FILTER_TEXT_CASES declares this shape refused `
    + `(INVALID_FILTER); the declared comparand for '${operator}' is a NON-EMPTY STRING`;
  if (target === '') {
    return (
      `filter comparand for field '${field}' on operator '${operator}' is the EMPTY `
      + `STRING. Every value contains the empty substring, so evaluating it is a `
      + `predicate that constrains nothing. ${declared}. Drop the condition instead `
      + `of sending an empty comparand`
    );
  }
  return (
    `filter comparand for field '${field}' on operator '${operator}' is `
    + `${target === null ? 'null' : typeof target} (${describeComparand(target)}), `
    + `not a string. Coercing it would answer a query nobody wrote. ${declared}. `
    + `Write the comparand as a string`
  );
}
