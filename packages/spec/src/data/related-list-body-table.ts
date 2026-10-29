// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27478 · ruling B on #27055] The ONE predicate behind "is this inbound
 * relationship a BODY TABLE of its parent's record page", and the one refusal
 * a field group's `relatedList` earns when it names a relationship that is not.
 *
 * Body-ness is decided once, by the relationship's own keys on the child's FK
 * field (`FieldSchema.relatedList`, `FieldSchema.inlineEdit`):
 *
 *  - `relatedList: 'primary'` — the author marks the list part of the
 *    record's main content;
 *  - a `master_detail` FK that sets `inlineEdit` (`true`, `'grid'` or
 *    `'form'`) and declares NO `relatedList` — line items edited inside the
 *    parent's form are drawn under it by default;
 *  - anything else is a side card (`true` / absent), or hidden (`false`).
 *    `relatedList: true` on an inline-edited `master_detail` keeps it a side
 *    card, as the key's own description says.
 *
 * A field group's `relatedList` (`ObjectFieldGroupSchema.relatedList`) only
 * POSITIONS a body table among the field sections; it never promotes a side
 * card. Giving body-ness a second source on the group would let the two
 * disagree (the FK saying side card, the group saying body), so a group that
 * names a relationship this predicate does not count is refused, with
 * {@link fieldGroupBodyTableRefusal}'s sentence, where the child's fields are
 * known: `defineStack` (`os validate`, `os build`) and the runtime object
 * publish door (`@objectstack/lint` `validate-related-list-refs`).
 *
 * Readers, one judgement (no second copy anywhere):
 *  - the record page: objectui `deriveRelatedLists` (`isPrimary`) and
 *    `RecordDetailView` (`isBody`), which decide which lists the synthesized
 *    page draws as body tables (`bodyTablePlacement`) and which as side cards;
 *  - Studio: the field-group inspector offers only body tables
 *    (`RelatedTablePlacement`), and the relationship field inspector reads an
 *    absent `relatedList` through it;
 *  - the refusal at `defineStack` and at the publish door.
 *
 * Read on either the PARSED field or a stored body: neither key carries a
 * default, so an omitted key is `undefined` on both and the verdict agrees.
 */

/** The FK keys body-ness is decided by — a child's `lookup` / `master_detail` field. */
export interface RelatedListRelationshipFields {
  readonly type?: unknown;
  readonly relatedList?: unknown;
  readonly inlineEdit?: unknown;
}

/**
 * Is the related list this FK field produces a BODY TABLE on its parent's
 * record page? See the module header for the rule. A field that is not a
 * `lookup` / `master_detail` produces no related list at all, so it is `false`.
 */
export function isBodyTableRelationship(field: RelatedListRelationshipFields | null | undefined): boolean {
  if (!field || (field.type !== 'lookup' && field.type !== 'master_detail')) return false;
  if (field.relatedList === 'primary') return true;
  if (field.relatedList !== undefined) return false;
  const inlineEdit = field.inlineEdit;
  return field.type === 'master_detail' && (inlineEdit === true || inlineEdit === 'grid' || inlineEdit === 'form');
}

/** One inbound relationship a field group's `relatedList` names: the child, its FK, and the FK's keys. */
export interface NamedInboundRelationship {
  readonly child: string;
  readonly field: string;
  readonly def: RelatedListRelationshipFields;
}

/**
 * The refusal for `fieldGroups[index].relatedList` (`entry`) on `objectName`,
 * given the inbound relationships the entry names (`named`, non-empty: an entry
 * naming none is the unknown-name refusal's case). `undefined` when every one
 * of them is a body table. `defineStack` and `@objectstack/lint` both write
 * this sentence, so the two surfaces cannot word it apart.
 *
 * A bare child name names every FK of that child, so it is refused when ANY of
 * them is not a body table; when one of them is, the prescription points at
 * `object.field` for it.
 */
export function fieldGroupBodyTableRefusal(
  objectName: string,
  index: number,
  entry: string,
  named: readonly NamedInboundRelationship[],
): string | undefined {
  const notBody = named.filter((r) => !isBodyTableRelationship(r.def));
  if (named.length === 0 || notBody.length === 0) return undefined;
  const what = notBody
    .map((r) => `'${r.child}.${r.field}' is ${r.def.relatedList === false ? 'hidden (relatedList: false)' : 'a side card'}`)
    .join(', ');
  const bodies = named.filter((r) => isBodyTableRelationship(r.def));
  const fk = notBody.length === 1 ? 'that FK' : 'those FKs';
  const pick = bodies.length > 0
    ? `, name only the body table as object.field (${bodies.map((r) => `'${r.child}.${r.field}'`).join(', ')})`
    : '';
  return (
    `Object '${objectName}' fieldGroups[${index}].relatedList '${entry}' names a related list that is not a body table: ` +
    `${what}. A field group's relatedList only positions a body table (a FK declaring relatedList: 'primary', ` +
    `or a master_detail FK that sets inlineEdit and declares no relatedList), so the record page draws nothing ` +
    `at the group for any other list. Set relatedList: 'primary' on ${fk}${pick}, or remove the group's relatedList.`
  );
}
