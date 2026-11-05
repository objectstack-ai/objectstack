// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// No D2 conversion: whether the set should read the object or should not write
// it is a judgement only the author can make, and either rewrite would change
// an access decision (adding read widens; dropping the bit narrows a caller
// whose read arrives from another set). Stored rows need none: the runtime
// already grants edit and delete only together with read.
export const entry: SemanticMigration = {
  id: 'permission-write-without-read-refused',
  surface:
    'security.permission.objects.*.allowEdit / allowDelete (ObjectPermissionSchema) set to true in an '
    + 'entry that grants no read (none of allowRead, viewAllRecords, modifyAllRecords is true)',
  replacement:
    'Decide which of the two the permission set means. If it should edit or delete the object: add '
    + '`allowRead: true` to the entry. If it should not: delete `allowEdit` / `allowDelete` from the entry. '
    + 'FROM `objects: { crm_lead: { allowEdit: true } }` TO `objects: { crm_lead: { allowRead: true, '
    + 'allowEdit: true } }` (or `objects: { crm_lead: {} }`).',
  reason:
    'Maintainer ruling, 2026-11-04: the permission model enforces that an object permission which edits '
    + 'or deletes a record also reads it. The authoring object-permission schema refuses an entry granting '
    + 'allowEdit or allowDelete without read, one `custom` issue at the bit\'s own path, and the permission '
    + 'evaluator grants edit and delete as `read ∧ grant` (the shape allowExport already had), folded by the '
    + 'spec\'s `objectPermissionGrants` over the caller\'s merged entries, so the read half may come from '
    + 'another set. The response-side EffectiveObjectPermissionSchema stays tolerant (the authorable/wire '
    + 'split). STORED ROWS AND OLDER BUILT ARTIFACTS: a permission set stored before this release keeps '
    + 'loading, and its unread edit or delete grant is not enforced; a built artifact carrying the shape is '
    + 'refused when it is parsed and must be rebuilt from a corrected source. The Setup permission editor '
    + 'ticks Read when Edit or Delete is ticked, and unticks Edit and Delete when Read is unticked. '
    + 'ADR-0049 / ADR-0087 / ADR-0090.',
  acceptanceCriteria:
    'Search every authored permission set for an object-permission entry (wildcard `*` included) that sets '
    + '`allowEdit: true` or `allowDelete: true` and none of `allowRead`, `viewAllRecords`, '
    + '`modifyAllRecords`, and decide as the replacement says. `PermissionSetSchema.safeParse` answers one '
    + '`custom` issue at `objects.<object>.allowEdit` or `objects.<object>.allowDelete` for each such bit. '
    + 'The repository carried no shipped permission set of this shape at the time of the change.',
};
