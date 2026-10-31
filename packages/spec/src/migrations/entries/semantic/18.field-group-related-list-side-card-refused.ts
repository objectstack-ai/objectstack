// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #27478 (ruling B on #27055) — a field group's `relatedList` only POSITIONS a
// body table among the field sections; whether a related list is a body table
// is decided once, by the relationship's own FK keys
// (`isBodyTableRelationship`, `data/related-list-body-table.ts`). A group that
// names a side card or a hidden list is refused at `defineStack` and at the
// runtime object publish door (`related-list-group-not-body`). Semantic only,
// with no D2 conversion: which of the two remedies the author meant (promote
// the relationship, or drop the placement) is not recorded anywhere.
export const entry: SemanticMigration = {
  id: 'field-group-related-list-side-card-refused',
  surface:
    'objects[].fieldGroups[].relatedList (data.ObjectFieldGroupSchema.relatedList) naming an inbound '
    + 'relationship that is not a body table — a lookup or master_detail FK on the child declaring '
    + 'relatedList true or false, a plain master_detail with no inlineEdit, a lookup with no relatedList, '
    + 'or a bare child name one of whose FKs is any of those',
  replacement:
    'one of two edits, the author\'s choice. To keep the table at the group: make the relationship a '
    + 'body table on the child\'s FK — `relatedList: \'primary\'`, or for an inline-edited master_detail '
    + 'remove an explicit `relatedList: true` — or, for a bare child name whose other FK is a side card, '
    + 'name the body table\'s FK as `object.field`. To keep the list a side card: remove the group\'s '
    + '`relatedList` (and the group itself, if it holds nothing else)',
  reason:
    'A field group\'s `relatedList` was described as placing a related list\'s body table at the '
    + 'group, but the record page draws only lists that ARE body tables by the FK\'s own keys '
    + '(`relatedList: \'primary\'`, or a master_detail FK that sets inlineEdit and declares no '
    + 'relatedList), so a group naming a side card or a hidden list parsed, published and drew nothing '
    + 'at the group — silently; Studio\'s group inspector offered every inbound relationship, so the '
    + 'public door produced it. Ruling B keeps body-ness in one place (the FK) instead of giving the '
    + 'group a second, disagreeing source, so the group is refused rather than honoured. The '
    + 'refusal is a cross-object judgement, not a parse: `defineStack` (os validate, os build) and the '
    + 'object publish door refuse it, naming each FK that is not a body table and the remedy. There is '
    + 'no D2 conversion: promoting the relationship changes every record page of the parent, and '
    + 'dropping the placement discards what the author wrote, so the edit is the author\'s. A STORED '
    + 'sys_metadata object row carrying such a group is not rewritten and still loads and registers '
    + 'unchanged (the object parse does not judge it); its record page draws the side card in the '
    + 'related column and nothing at the group, as before — except one shape the page used to read '
    + 'apart from the FK\'s own description: an inline-edited master_detail FK declaring relatedList '
    + 'true was drawn as a body table, and is a side card now, so a group placing it draws nothing at '
    + 'the group and the list moves to the related column — and the next '
    + 'save of that object through the metadata write door is refused 422 INVALID_METADATA at '
    + 'fieldGroups[i].relatedList until it is fixed. A write of the CHILD that turns a body table a '
    + 'stored group places into a side card is refused the same way. In-repo census before the change: '
    + 'no example, platform object, dogfood fixture or HotCRM object declared a field group relatedList '
    + 'at all; deployed metadata was NOT measured. ADR-0085 / ADR-0087',
  acceptanceCriteria:
    'os validate (defineStack) passes with no STACK_CROSS_REFERENCE_INVALID issue reading "names a '
    + 'related list that is not a body table", and a save of each changed object through the metadata '
    + 'write door answers 200 instead of 422 related-list-group-not-body. On the record page, each group '
    + 'kept with a promoted relationship draws that body table at its position in the details column; '
    + 'each removed placement leaves the list a side card in the related column, as it was drawn '
    + 'before. A group naming a body table, and every relatedLists entry, parse and publish '
    + 'byte-identically to before.',
};
