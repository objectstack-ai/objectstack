// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #26725. An accept-set narrowing of the object schema: two entries of one
// object's actions array under the same name are refused by the object parse,
// so the object save door answers 422 INVALID_METADATA where it saved and
// published the pair. defineStack's duplicate action-key check already refused
// it for a stack. No D2 conversion: which declaration keeps the name is the
// author's call. The v18 stored-row listing names each stored object it refuses.
export const entry: SemanticMigration = {
  id: 'object-duplicate-action-name-refused',
  surface:
    "object.actions — two or more entries under the same name, e.g. actions: [{ name: 'approve', ... }, "
    + "{ name: 'approve', ... }]",
  replacement:
    'One entry per action name on each object. Rename all but one of the colliding entries (and every '
    + 'button, flow and caller that runs the renamed one by name), or delete the duplicate. Distinct names, '
    + 'and the same name on two different objects, are unchanged.',
  reason:
    'An action name identifies the action on its object: the runtime registers and dispatches it under '
    + 'the object and the name, and the action endpoint addresses it by that pair. The object save door saved and published an object declaring two actions '
    + 'under one name (200 on save, 200 on publish, both served), so which declaration ran was undefined; '
    + 'Studio wrote that shape when an action was renamed to a name another action already held. '
    + 'defineStack and objectstack validate already refused the pair inside a stack; every door that parses '
    + 'an object now refuses it, naming the name and every index. Not convertible: which declaration keeps '
    + 'the name is a fact only the author holds.',
  acceptanceCriteria:
    'Each object saves without an INVALID_METADATA issue at actions[i] of the form "Object X declares the '
    + 'action Y twice in actions: actions[i] and actions[j]". os migrate meta --stored lists each stored '
    + 'object that still repeats a name, under the TODO id object-duplicate-action-name-refused; until '
    + 'it is fixed the object loads under a metadata_spec_invalid diagnostic and its next save is refused. '
    + 'After renaming, check that every button and caller of the renamed action runs the declaration you meant.',
};
