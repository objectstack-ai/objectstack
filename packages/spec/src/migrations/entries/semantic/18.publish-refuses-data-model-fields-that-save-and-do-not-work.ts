// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the Data model family of the second batch of
// author-time rules (#35143) that refuse, at publish and in `os validate` /
// `build`, an object the schema still accepts but whose roll-up never computes
// or whose field carries a `reference` nothing links through. Notice only: no
// key is removed and no D2 conversion exists, because each fix is a choice only
// the author can make (which child field points back, which type a field is).
export const entry: SemanticMigration = {
  id: 'publish-refuses-data-model-fields-that-save-and-do-not-work',
  surface:
    'Two author-time object errors, run by the runtime publish gate and by `os validate` / `lint` / `compile` / `build`: '
    + 'a `summary` field whose child object has no `lookup` / `master_detail` field referencing the parent, or whose '
    + '`summaryOperations.relationshipField` names no field of the child (`rollup/child-without-parent-reference`); a '
    + '`reference` on a field type that reads none, anything but `lookup`, `master_detail`, `user`, `tree` and `summary` '
    + '(`field/reference-on-non-reference-type`)',
  replacement:
    'Give the child a field that points back (`{ type: \'master_detail\', reference: \'<parent>\' }` or a lookup), or name '
    + 'the child field that holds the parent id in `summaryOperations.relationshipField`; make a field that links a record '
    + 'a `lookup` (`{ type: \'lookup\', reference: \'<object>\' }`), or remove `reference` from it',
  reason:
    'Each object parses and publishes, then does not work: the engine finds no child rows of a parent for a roll-up with no '
    + 'foreign key, so the summary is never indexed, never computed and reads 0 or empty while every child write reports '
    + 'success; a `reference` on a text, number or select field links nothing, and the record page edits such a field '
    + 'with a record picker that writes a record id into it. Stored objects are not rewritten or refused at boot. The next '
    + 'publish of an object that carries one of the two errors is refused with the fix named. Two warnings join them '
    + '(`field/count-named-lookup`, a relationship field named like a count or a total; '
    + '`approval-detail-editable-while-pending`, a lookup child drawn as a table in the record body of a record under a '
    + 'locking approval, whose rows the lock does not cover), which refuse nothing and make `os validate --strict` exit 1 '
    + 'as any warning does.',
  acceptanceCriteria:
    'os validate reports neither error; a publish of every object the package carries succeeds.',
};
