// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// No D2 conversion: whether the holders of the set should read the field or
// should not is a judgement only the author can make, and either rewrite would
// change an access decision (deleting the row serves the field to them, keeping
// it withholds the field). Stored rows need none: the pair parses as it did.
export const entry: SemanticMigration = {
  id: 'permission-own-field-mask-binds-over-own-view-all',
  surface:
    'security.permission.fields.*.readable (FieldPermissionSchema) set to false, in a permission set '
    + 'whose own object entry for the field\'s object (the `*` wildcard included) grants viewAllRecords '
    + 'and does not grant modifyAllRecords',
  replacement:
    'Decide which of the two the permission set means. If its holders should read the field: delete the '
    + 'field row, or set `readable: true` on it. If they should not: keep the row, which now hides the '
    + 'field from them. FROM `objects: { crm_lead: { allowRead: true, viewAllRecords: true } }, fields: '
    + '{ \'crm_lead.score\': { readable: false } }` (the row bound none of the set\'s holders) TO the same '
    + 'pair (the row hides `score` from them), or to the pair without the row (they read `score`).',
  reason:
    'Maintainer ruling, 2026-11-15 (ADR-0066 D2 ⑧, note of 2026-11-15): an explicit `readable: false` '
    + 'field-permission row on a permission set wins over that same set\'s View All field vote. A set that '
    + 'holds View All on an object, and not Modify All, casts no read vote on a field its own row hides, so '
    + 'a holder reads the field only when another set they hold casts a read vote on it: that set\'s own '
    + '`readable: true` row, or its View All or Modify All on the object. A co-held set that says nothing '
    + 'about the field does not restore it. Every reader of the field-permission merge answers the same: '
    + 'the data doors, through `PermissionEvaluator.getFieldPermissions`, and the `fields` slot of '
    + '`/auth/me/permissions`. Until this release the set\'s own View All voted the field readable, so the '
    + 'row bound none of the set\'s holders (the ADR\'s note of 2026-11-02).\n\n'
    + 'NOT MOVED: another set\'s View All or Modify All on the object still reads the field for a caller '
    + 'who holds both sets; a View All set still votes on every field it does not hide itself; an omitted '
    + '`readable` parses to `true` and is not a mask; an edit lock beside View All binds as before; a set '
    + 'holding Modify All on the object votes on every field of it, its own rows included; the row-level '
    + 'bypass does not read field rows.\n\n'
    + 'STORED ROWS: a permission set stored before this release keeps loading unchanged, and its row '
    + 'starts to bind when the release runs. No mechanical rewrite exists in either direction: deleting '
    + 'the row and keeping it are both access decisions.',
  acceptanceCriteria:
    'Search every authored and stored permission set for a `fields` row with `readable: false` on a field '
    + 'of an object that the same set grants `viewAllRecords` (through the object\'s own entry or the `*` '
    + 'wildcard) without `modifyAllRecords`, and decide as the replacement says. On a release from '
    + '18.3.0 up to this change, `os validate` names each such row with the warning '
    + '`security-superuser-field-mask-inert` beside View All; from this release that rule reports only a '
    + 'row beside the set\'s own Modify All, so it no longer lists the pair. The repository carried no '
    + 'shipped permission set with the pair at the time of the change.',
};
