// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #29253 (PR #29368) made a declared `deleteBehavior` on a `user` field take
// effect when the user is deleted; this entry is its ADR-0087 record (#29415,
// should-fix A of that PR's contract review). A semantic entry and not a
// conversion, as `field-master-detail-set-null-refused` is: no key moved, the
// enforcement of an accepted declaration changed, and whether a declaration
// was meant as an outcome or as documentation is the author's to say.
export const entry: SemanticMigration = {
  id: 'user-field-delete-behavior-enforced',
  surface:
    '`object.fields[].deleteBehavior` (and `objectExtension.fields[].deleteBehavior`) on a field of '
    + '`type: \'user\'`.',
  replacement:
    'Declare on a `user` field only the `deleteBehavior` you want enforced when the referenced user is '
    + 'deleted: `restrict` refuses the delete, `cascade` deletes the rows holding the user, `set_null` '
    + 'clears the field (on a `multiple: true` field, removes that user). Drop the key to keep the field '
    + 'out of the delete walk: a `user` field that declares no `deleteBehavior` keeps the deleted user\'s '
    + 'id, as before.',
  reason:
    'The spec always accepted and round-tripped `deleteBehavior` on a `user` field, but the referential '
    + 'delete walk read it only on `master_detail`, `lookup` and `tree` fields, so the declaration did '
    + 'nothing: a `restrict` refused no delete and a `cascade` deleted no row. A `user` field that '
    + 'declares a value now joins the walk and reads it as a `lookup` reads its own, so a delete that '
    + 'succeeded can now be refused with 409 `DELETE_RESTRICTED`, and rows can now be deleted or '
    + 'cleared. A `user` field that declares nothing stays out: the parse writes no default on it and '
    + 'the engine invents none. No conversion can carry the change, because no key or value moved; '
    + 'what is owed is the author\'s reading of each declaration. One stored population needs it most: '
    + 'objects saved while the parse still wrote `deleteBehavior: \'set_null\'` on every field type '
    + 'can carry a `set_null` on a `user` field that nobody authored. On a field that is not '
    + '`required` it now clears the field when the user is deleted, which is what the same declaration '
    + 'does on a `lookup`, and is accepted as it is. On a `required` field it now refuses the user '
    + 'delete with 409 `DELETE_RESTRICTED` wherever clearing would leave the field empty, a refusal no '
    + 'author chose.',
  acceptanceCriteria:
    'Every `user` field that declares `deleteBehavior` declares the outcome its author wants when the '
    + 'referenced user is deleted, and a `required` `user` field carries `set_null` only where refusing '
    + 'that delete is intended. A stored object whose `user` field carries a `deleteBehavior` nobody '
    + 'wrote is saved again without the key, or with the value chosen. Deleting a test user that each '
    + 'such field holds gives the declared outcome: 409 `DELETE_RESTRICTED` for `restrict` (and for '
    + '`set_null` on a `required` field that the delete would leave empty), the holding rows deleted for '
    + '`cascade`, the field cleared for `set_null`, and the id kept where the field declares nothing.',
};
