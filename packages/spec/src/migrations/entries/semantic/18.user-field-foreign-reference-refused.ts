// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #24808 ruled A on #24854 (enforce the declaration that a `user` field's
// target is fixed to `sys_user`), shipped in an 18.x minor under the amended
// 「甲」 ruling. A semantic entry and not a conversion: the only rewrite that
// keeps the link — to a `lookup` on the named object — changes the field's
// delete behaviour, and which behaviour the author wants is theirs to say.
export const entry: SemanticMigration = {
  id: 'user-field-foreign-reference-refused',
  surface:
    '`object.fields[].reference` (and `objectExtension.fields[].reference`) on a field of `type: \'user\'`, '
    + 'when it names an object other than `sys_user`.',
  replacement:
    'A `lookup` on the named object: `{ type: \'lookup\', reference: \'TARGET\' }` (`Field.lookup` with '
    + 'the target as its first argument), with the `deleteBehavior` the author chooses. If a person was '
    + 'meant, keep `type: \'user\'` and drop `reference`.',
  reason:
    'A `user` field\'s target is a constant of the type, and the spec refuses any other name at parse. '
    + 'The field was half one thing and half another: readers that follow the target treated it as a '
    + 'link to the named object, while readers that branch on the type (the person picker, a '
    + '`current_user` default, a sharing rule over the users a field holds) treated its values as users. '
    + 'No conversion can carry the rewrite. A `lookup` joins the referential delete walk and gets '
    + '`deleteBehavior: \'set_null\'` by default, so it would start clearing the column when the target '
    + 'record is deleted, which a `user` field never did, and `deleteBehavior` has no value that means '
    + '"leave it". A converted field would also stop counting as one that holds users for sharing, and '
    + 'a `current_user` default on it would be refused. So a delete-behaviour judgement is owed by the '
    + 'author.',
  acceptanceCriteria:
    'Every `user` field in the stack either declares no `reference` or declares `reference: \'sys_user\'`, '
    + 'and `os validate` passes. A field that still names another object is refused at parse with an '
    + 'issue at `fields.NAME.reference` that names the `lookup` spelling. For each field moved to a '
    + '`lookup`, its `deleteBehavior` is set on purpose and its default value, if any, is not '
    + '`current_user`. A stored object whose body carries the old shape is served as stored, but the '
    + 'runtime resolves its `user` field to `sys_user` (expand, import, seed loading), and the next save of the object is refused until '
    + 'the field is fixed.',
};
