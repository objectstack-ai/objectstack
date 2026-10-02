// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19889] The words the two filter doors share — the comparand-shape FACE
 * (`./filter-comparand-shape.ts`, which every query crosses) and the SCHEMA
 * door (`./filter.zod.ts`, which every stored filter crosses on save).
 *
 * ## Why a module of its own
 *
 * The 2026-09-24 ruling on #19889 (letter A, record 5805248669) refuses an
 * ARRAY in the EQUALITY slot at the schema door "with the SAME remedy text the
 * shared compile face emits — one constant, two doors". The face already
 * refused it (#19757, ruling 乙). So the text has to live where BOTH doors can
 * import it, and neither door can be that place: `filter.zod.ts` imports the
 * face, and the face cannot import `filter.zod.ts` back — the cycle the face's
 * `LIST_COMPARAND_OPERATORS` docblock records. A module both import breaks the
 * tie. It imports nothing.
 *
 * [#19886] The `$ne` slot is the second tenant, for the same reason. Ruling A
 * (record 5805254639) refuses an array under `$ne` at the shared face and at
 * `FieldOperatorsSchema.$ne` with "one remedy text", so that sentence is
 * assembled here too, by {@link arrayInequalityComparandMessage}.
 *
 * [#21448] Every other scalar slot is the third, by
 * {@link arrayScalarComparandMessage}: the face refuses a list there and the
 * save door words the same refusal, so both import it from here.
 *
 * ## Why it is NOT in the `data` barrel
 *
 * Nothing here is a contract a consumer calls; the two refusals are, and they
 * are already published (`assertListComparandShapes`, and the schemas
 * themselves). Exporting the text would widen `@objectstack/spec/data` for no
 * reader, so this file stays out of `./index.ts`, as
 * `./currency-fraction-digits.ts` does. Consumers read the words where the
 * refusals put them: the `Error` message at the face, the issue message at the
 * schema door.
 */

/**
 * The authoring spellings that lower to `$in`.
 *
 * The face's `LIST_COMPARAND_OPERATORS` reads its `$in` row from here, so the
 * refusal of a malformed `$in` and the equality-slot refusal (which prescribes
 * `$in`) name one spelling list. `filter-comparand-shape.test.ts` reconciles
 * the list against `AST_OPERATOR_MAP`.
 */
export const IN_OPERATOR_SPELLINGS: readonly string[] = ['in'];

/**
 * [#19886] The authoring spellings that lower to `$nin`.
 *
 * `$nin` is the list-negation operator `FieldOperatorsSchema` declares ("Not
 * in list"), and it is what the `$ne` refusal prescribes. So, as with
 * {@link IN_OPERATOR_SPELLINGS}, the face's `LIST_COMPARAND_OPERATORS` reads its
 * `$nin` row from here, and the refusal of a malformed `$nin` and the `$ne`
 * refusal (which prescribes `$nin`) name one spelling list.
 * `filter-comparand-shape.test.ts` reconciles the list against `AST_OPERATOR_MAP`.
 */
export const NIN_OPERATOR_SPELLINGS: readonly string[] = ['nin', 'not_in', 'notin'];

/**
 * [#21448] The authoring spellings that lower to `$between`.
 *
 * `$between` is the range operator the scalar-slot refusal prescribes beside
 * `$in`. So, as with {@link IN_OPERATOR_SPELLINGS}, the face's
 * `LIST_COMPARAND_OPERATORS` reads its `$between` row from here, and the
 * refusal of a malformed `$between` and the scalar-slot refusal name one
 * spelling list. `filter-comparand-shape.test.ts` reconciles the list against
 * `AST_OPERATOR_MAP`.
 */
export const BETWEEN_OPERATOR_SPELLINGS: readonly string[] = ['between'];

/**
 * [#19757] The ARRAY-CONTAINMENT operator the equality-slot refusal prescribes,
 * with its authoring spelling: `$contains`, which `FieldOperatorsSchema`
 * declares as a MEMBERSHIP test on a `multiple: true` / JSON-stored column
 * ("the stored list holds this value"). The other half of the prescription is
 * `$in`, read off {@link IN_OPERATOR_SPELLINGS}. Reconciled by pin in
 * `filter-comparand-shape.test.ts`.
 */
export const ARRAY_CONTAINMENT_OPERATOR = { op: '$contains', spellings: ['contains'] } as const;

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
 * `filter-comparand-shape.test.ts` pins the assembled length under that bound so
 * a later edit cannot silently push the tail off the wire.
 *
 * Moved here from the face (#19889) so the schema door renders a received list
 * with the same characters the face does.
 */
export function shapePreview(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

/**
 * The ONE remedy for an array in the equality slot: the two operators an author
 * holding a list was reaching for, by their spec spellings and their authoring
 * spellings, then the sentence a caller cannot infer from a status code.
 *
 * - `$in` — "one of these values" (authoring spelling `in`).
 * - `$contains` — "the stored list holds a value" on a multi-value field
 *   (authoring spelling `contains`), and an `$or` of those for any-of.
 *
 * The corrected shapes are written WITHOUT the field wrapper and with `…` for
 * the value: the field is the subject of the sentence in front of this one,
 * and the 500-char client bound buys more as prescription than as a second
 * echo of the field name or the received list.
 *
 * The closing sentence is the face's, and it is kept at the schema door too:
 * a refused filter is one that was NOT applied, and the reason for refusing
 * rather than dropping it is that a dropped filter shows MORE rows than the
 * author asked for — the ruling's own ground for never dropping one silently.
 */
export const ARRAY_EQUALITY_COMPARAND_REMEDY: string =
  `For "one of these values" use {"$in": […]} (authoring: ${IN_OPERATOR_SPELLINGS.join(', ')}); ` +
  `for "the stored list holds a value" on a multi-value field, ` +
  `{"${ARRAY_CONTAINMENT_OPERATOR.op}": "…"} ` +
  `(authoring: ${ARRAY_CONTAINMENT_OPERATOR.spellings.join(', ')}), an $or of those for any-of. ` +
  `The filter was NOT applied, and an unapplied filter would have returned the ` +
  `UNFILTERED result set.`;

/**
 * Where the refused array sits, as far as the calling door can see.
 *
 * - `op: '$eq'` — the explicit spelling. The `field` is optional because one
 *   door cannot know it: `FieldOperatorsSchema.$eq` is judged inside a
 *   single field's operator map, whose key belongs to the enclosing record.
 * - no `op` — the implicit form `{ field: [...] }`, which only exists as a
 *   field entry, so the field is always known.
 * - `path` — the face's dotted location (`where.stage`). The schema door
 *   passes none: a zod refinement cannot see where it sits in the document,
 *   and the issue it raises carries that location as its own `path`.
 */
export type ArrayEqualityComparandSite =
  | { readonly op: '$eq'; readonly field?: string; readonly path?: string }
  | { readonly op?: undefined; readonly field: string; readonly path?: string };

/**
 * The refusal of an ARRAY as an EQUALITY comparand, as both doors print it.
 *
 * The leading sentence is `driver-memory`'s `arrayComparandError` verbatim, so
 * one condition keeps one wording across packages (#5240's rule, applied
 * across packages). Then the received list, bounded by {@link shapePreview};
 * then the location when the door knows it; then
 * {@link ARRAY_EQUALITY_COMPARAND_REMEDY}.
 *
 * For a given field, value and operator the two doors therefore print the same
 * characters, with one difference: the face adds ` at <path>` and the schema
 * door does not, because the schema door's issue carries that location as its
 * own `path`. `filter-equality-array-schema-door.test.ts` pins exactly that.
 */
export function arrayEqualityComparandMessage(
  value: unknown,
  site: ArrayEqualityComparandSite,
): string {
  const position = site.op
    ? operatorPosition(site.op, site.field)
    : `The implicit-equality comparand on field "${site.field}"`;
  return singleValueSlotMessage(position, value, site.path, ARRAY_EQUALITY_COMPARAND_REMEDY);
}

/**
 * [#19886] The ONE remedy for an array under `$ne`: the declared list-negation
 * operator, by its spec spelling and its authoring spellings, then the sentence
 * a caller cannot infer from a status code.
 *
 * Ruling A on #19886 (record 5805254639) asks for exactly this: "one remedy
 * text, naming the declared list-negation operator by its spec spelling", read
 * off `FieldOperatorsSchema`, where `$nin` is the operator declared as "Not in
 * list". ⛔ Nothing else is offered. `$notContains` is declared on a STRING
 * comparand and is not a list operator, and a second remedy here would be an
 * invented one. `$nin` is also the remedy the formula evaluator and
 * `driver-mongodb` already name for the same shape.
 *
 * Written like {@link ARRAY_EQUALITY_COMPARAND_REMEDY}: no field wrapper and
 * `…` for the value, because the field is the subject of the sentence in front
 * of this one.
 */
export const ARRAY_INEQUALITY_COMPARAND_REMEDY: string =
  `For "none of these values" use {"$nin": […]} (authoring: ${NIN_OPERATOR_SPELLINGS.join(', ')}). ` +
  `The filter was NOT applied, and an unapplied filter would have returned the ` +
  `UNFILTERED result set.`;

/**
 * [#19886] Where the refused array under `$ne` sits, as far as the calling door
 * can see. The same rules as {@link ArrayEqualityComparandSite}'s `$eq` arm:
 * `FieldOperatorsSchema.$ne` judges one field's operator map and cannot see the
 * field, and the face passes `path` because a zod refinement cannot know it.
 */
export type ArrayInequalityComparandSite = { readonly field?: string; readonly path?: string };

/**
 * [#19886] The refusal of an ARRAY under `$ne`, as both doors print it — the
 * shared comparand-shape face and `FieldOperatorsSchema.$ne`.
 *
 * The leading sentence is `driver-memory`'s `arrayComparandError` for the same
 * operator, word for word, so one condition keeps one wording across packages
 * (#5240's rule). Then the received list, bounded by {@link shapePreview}, the
 * location when the door knows it, and {@link ARRAY_INEQUALITY_COMPARAND_REMEDY}.
 *
 * As with {@link arrayEqualityComparandMessage}, the two doors print the same
 * characters for a given value, except that the face adds ` at <path>` and names
 * the field. `filter-ne-array-schema-door.test.ts` pins exactly that.
 */
export function arrayInequalityComparandMessage(
  value: unknown,
  site: ArrayInequalityComparandSite,
): string {
  return singleValueSlotMessage(
    operatorPosition('$ne', site.field),
    value,
    site.path,
    ARRAY_INEQUALITY_COMPARAND_REMEDY,
  );
}

/**
 * [#21448] The ONE remedy for a list at any other scalar operator — an ordering
 * operator, a text operator or a flag: write the one value, and the two list
 * operators an author holding a list may have meant, by their spec spellings
 * and their authoring spellings. Then the sentence a caller cannot infer from a
 * status code.
 *
 * - `$in` — "one of these values" (authoring spelling `in`).
 * - `$between` — a range (authoring spelling `between`), what a two-member
 *   list under an ordering operator most often stands for.
 *
 * Written like {@link ARRAY_EQUALITY_COMPARAND_REMEDY}: no field wrapper and
 * `…` for the value, because the field is the subject of the sentence in front
 * of this one, and the 500-char client bound buys more as prescription.
 */
export const ARRAY_SCALAR_COMPARAND_REMEDY: string =
  'Write ONE value. ' +
  `For "one of these values" use {"$in": […]} (authoring: ${IN_OPERATOR_SPELLINGS.join(', ')}); ` +
  `for a range, {"$between": [min, max]} (authoring: ${BETWEEN_OPERATOR_SPELLINGS.join(', ')}). ` +
  `The filter was NOT applied, and an unapplied filter would have returned the ` +
  `UNFILTERED result set.`;

/**
 * [#21448] Where the refused list sits, as far as the calling door can see. The
 * operator is always known: this refusal exists only under an operator. The
 * face passes `field` and `path`; the save door passes `field` alone, because
 * its issue carries the location as its own `path`.
 */
export type ArrayScalarComparandSite = { readonly field?: string; readonly path?: string };

/**
 * [#21448] The refusal of a LIST at a scalar operator other than `$eq` / `$ne`
 * (each of which has its own sentence and remedy, above), as the doors print
 * it — the shared comparand-shape face and the save door.
 *
 * The leading sentence is `driver-memory`'s `arrayComparandError` for the same
 * operator, word for word, so one condition keeps one wording across packages
 * (#5240's rule). Then the received list, bounded by {@link shapePreview}, the
 * location when the door knows it, and {@link ARRAY_SCALAR_COMPARAND_REMEDY}.
 */
export function arrayScalarComparandMessage(
  op: string,
  value: unknown,
  site: ArrayScalarComparandSite,
): string {
  return singleValueSlotMessage(
    operatorPosition(op, site.field),
    value,
    site.path,
    ARRAY_SCALAR_COMPARAND_REMEDY,
  );
}

/** `Operator "$op"`, plus ` on field "f"` when the door can see the field. */
function operatorPosition(op: string, field: string | undefined): string {
  return `Operator "${op}"${field === undefined ? '' : ` on field "${field}"`}`;
}

/**
 * The sentence every single-value-slot refusal shares: the position, the words
 * `driver-memory` uses for this condition, the received list, the location and
 * the slot's own remedy. One template, so the `$eq`, `$ne` and [#21448] other
 * scalar-slot refusals cannot drift apart in their first sentence.
 */
function singleValueSlotMessage(
  position: string,
  value: unknown,
  path: string | undefined,
  remedy: string,
): string {
  const location = path === undefined ? '' : ` at ${path}`;
  return (
    `${position} requires a single comparable value, but received an array ` +
    `(${shapePreview(value)})${location}. ${remedy}`
  );
}
