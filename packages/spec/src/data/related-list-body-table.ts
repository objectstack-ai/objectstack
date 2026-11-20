// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27478 · ruling B on #27055, as amended by #35597 and #35889] The ONE
 * predicate behind "is this inbound relationship a BODY TABLE of its parent's
 * record page", the one behind "may a field group place it", and the one
 * refusal a field group's `relatedList` earns when it names a relationship it
 * cannot place.
 *
 * A body table is decided by the relationship's own keys on the child's FK
 * field (`FieldSchema.relatedList`) and by the parent's field groups:
 *
 *  - `relatedList: 'primary'` — the author marks the list part of the
 *    record's main content, with or without a group;
 *  - a `master_detail` FK that declares NO `relatedList` is a TAB by default
 *    (#35889, the maintainer's 「主从子表我认为不应该自动申明放在概览中，
 *    除非我通过 fieldGroup 强制指定」, superseding #35597's "body table by
 *    default"). It becomes a body table only when one of the PARENT's field
 *    groups names it (`ObjectFieldGroupSchema.relatedList`): then it is drawn
 *    at that group's position, and the forms and the record page's edit state
 *    carry it there. `inlineEdit` takes no part: it is the WRITE side (the
 *    parent's entry form, ADR-0035 §3);
 *  - anything else is a tab (`true`, or a `lookup` with no `relatedList`), or
 *    hidden (`false`). `relatedList: true` on a `master_detail` keeps it a tab,
 *    which a group cannot override. A `lookup` child is a body table only by
 *    `'primary'`.
 *
 * So a field group places either a `'primary'` list (positioning it) or a
 * plain `master_detail` list (making it a body table there); every other
 * relationship a group names is refused, with
 * {@link fieldGroupBodyTableRefusal}'s sentence, where the child's fields are
 * known: `defineStack` (`os validate`, `os build`) and the runtime object
 * publish door (`@objectstack/lint` `validate-related-list-refs`). The set a
 * group may name is the set #35597 accepted, unchanged.
 *
 * Readers, one judgement (no second copy anywhere):
 *  - the record page: objectui `deriveRelatedLists` (`isPrimary`, which hands
 *    {@link isBodyTableRelationship} whether a parent group names the list)
 *    and `RecordDetailView` (`isBody`), which decide which lists the
 *    synthesized page draws as body tables (`bodyTablePlacement`) and which as
 *    tabs; the parent's entry form, which inlines the lists a group places;
 *  - Studio: the field-group inspector offers only what a group may place
 *    ({@link isGroupPlaceableRelationship}), and the relationship field
 *    inspector reads an absent `relatedList` through it;
 *  - the refusal at `defineStack` and at the publish door.
 *
 * Read on either the PARSED field or a stored body: `relatedList` carries no
 * default, so an omitted key is `undefined` on both and the verdict agrees.
 */

/**
 * The FK keys body-ness is decided by — a child's `lookup` / `master_detail`
 * field. `inlineEdit` stays accepted so a caller can hand over the whole field;
 * it does not change the verdict (#35597).
 */
export interface RelatedListRelationshipFields {
  readonly type?: unknown;
  readonly relatedList?: unknown;
  readonly inlineEdit?: unknown;
}

/** What else decides a body table besides the FK's own keys. */
export interface BodyTableContext {
  /**
   * True when one of the PARENT object's field groups names this relationship
   * (`fieldGroups[].relatedList`, a child object name or `object.field`).
   */
  readonly placedByGroup?: boolean;
}

/**
 * May a field group of the parent place the related list this FK produces?
 * `'primary'` lists (the group positions them) and plain `master_detail` lists
 * with no `relatedList` (the group makes them body tables, #35889). Every other
 * relationship, and a field that is not a `lookup` / `master_detail`, is
 * `false`.
 */
export function isGroupPlaceableRelationship(field: RelatedListRelationshipFields | null | undefined): boolean {
  if (!field || (field.type !== 'lookup' && field.type !== 'master_detail')) return false;
  if (field.relatedList === 'primary') return true;
  return field.relatedList === undefined && field.type === 'master_detail';
}

/**
 * Is the related list this FK field produces a BODY TABLE on its parent's
 * record page? `'primary'` always is; a plain `master_detail` is only when a
 * parent field group places it (`context.placedByGroup`, #35889); anything
 * else never is. See the module header for the rule. A field that is not a
 * `lookup` / `master_detail` produces no related list at all, so it is `false`.
 */
export function isBodyTableRelationship(
  field: RelatedListRelationshipFields | null | undefined,
  context?: BodyTableContext,
): boolean {
  if (!isGroupPlaceableRelationship(field)) return false;
  return field!.relatedList === 'primary' || context?.placedByGroup === true;
}

/**
 * Does one of a PARENT object's field groups name the related list `child.field`
 * (`fieldGroups[].relatedList`: a bare child object name names every FK of that
 * child, `object.field` names one)? The `placedByGroup` answer
 * {@link isBodyTableRelationship} takes, for every reader that holds the parent
 * (objectui's record page and entry form, `@objectstack/lint`). Tolerant of a
 * stored or unparsed body: a group that is not a record, or whose `relatedList`
 * is not a non-empty string, names nothing.
 */
export function fieldGroupsPlaceRelationship(
  fieldGroups: unknown,
  child: string,
  field: string,
): boolean {
  if (!Array.isArray(fieldGroups)) return false;
  return fieldGroups.some((group) => {
    const entry = group && typeof group === 'object' ? (group as { relatedList?: unknown }).relatedList : undefined;
    if (typeof entry !== 'string' || entry.length === 0) return false;
    const dot = entry.indexOf('.');
    return dot === -1 ? entry === child : entry.slice(0, dot) === child && entry.slice(dot + 1) === field;
  });
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
 * naming none is the unknown-name refusal's case). `undefined` when a group may
 * place every one of them ({@link isGroupPlaceableRelationship}). `defineStack` and `@objectstack/lint` both write
 * this sentence, so the two surfaces cannot word it apart.
 *
 * A bare child name names every FK of that child, so it is refused when ANY of
 * them cannot be placed; when one of them can, the prescription points at
 * `object.field` for it.
 */
export function fieldGroupBodyTableRefusal(
  objectName: string,
  index: number,
  entry: string,
  named: readonly NamedInboundRelationship[],
): string | undefined {
  const notBody = named.filter((r) => !isGroupPlaceableRelationship(r.def));
  if (named.length === 0 || notBody.length === 0) return undefined;
  const what = notBody
    .map((r) => `'${r.child}.${r.field}' is ${r.def.relatedList === false ? 'hidden (relatedList: false)' : 'a side card'}`)
    .join(', ');
  const bodies = named.filter((r) => isGroupPlaceableRelationship(r.def));
  const fk = notBody.length === 1 ? 'that FK' : 'those FKs';
  const pick = bodies.length > 0
    ? `, name only the body table as object.field (${bodies.map((r) => `'${r.child}.${r.field}'`).join(', ')})`
    : '';
  return (
    `Object '${objectName}' fieldGroups[${index}].relatedList '${entry}' names a related list that is not a body table: ` +
    `${what}. A field group's relatedList only places a body table (a FK declaring relatedList: 'primary', ` +
    `or a master_detail FK that declares no relatedList, which the group makes one), so the record page draws nothing ` +
    `at the group for any other list. Set relatedList: 'primary' on ${fk}${pick}, or remove the group's relatedList.`
  );
}
