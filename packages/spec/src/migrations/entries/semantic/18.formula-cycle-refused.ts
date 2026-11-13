// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #33100: an accept-set narrowing of `os build`, `os validate` and the object
// save and publish door. The engine computes an object's formulas in
// dependency order, so a formula reading another formula reads its value; a
// formula on a cycle of formulas has no order and reads null, and is now
// refused where it is authored. No D2 conversion: which read breaks the cycle
// is a fact only the author holds.
export const entry: SemanticMigration = {
  id: 'formula-cycle-refused',
  surface:
    'a `formula` field whose `expression` reads its own value, itself or through the formulas it reads, e.g. '
    + '`f_total: { type: \'formula\', expression: \'record.f_total * 2\' }`, or '
    + '`f_x: { type: \'formula\', expression: \'record.f_y + 1\' }` beside '
    + '`f_y: { type: \'formula\', expression: \'record.f_x + 1\' }`.',
  replacement:
    'A formula that reads other formulas only when none of them reads it back: read the stored fields the '
    + 'other formula reads instead of that formula. A formula reading another formula with no cycle is accepted '
    + 'and reads the computed value.',
  reason:
    'The engine computed formulas in declaration order, so a formula reading another formula read null whenever '
    + 'it came first. It now computes each formula after the formulas it reads. A formula on a cycle has no such '
    + 'order, and `os build`, `os validate` and the object door accepted it. An unguarded member read null on every '
    + 'row; a member whose read of the cycle is guarded (`has(record.f_self) ? record.f_self : 1`, or an optional '
    + 'spelling) could read a value that depended on the order its formulas were computed in, and now reads null '
    + 'with the cycle fault. The doors now refuse each declared formula on a cycle, located on its `expression` '
    + '(`object \'OBJECT\' · field \'FIELD\' expression`), with the sentence the engine reports for it at read time.',
  acceptanceCriteria:
    'Run `os validate` (or `os build`) on the stack: no `expression-invalid` error says a formula "reads its own '
    + 'value through the formulas it reads". Then read a record of each object that has formulas reading formulas '
    + 'and confirm each of those formulas holds a value. An object already published with a cycle still loads, and '
    + 'its cycle members read null with the cycle fault in the log; its next save is refused until the cycle is '
    + 'broken.',
};
