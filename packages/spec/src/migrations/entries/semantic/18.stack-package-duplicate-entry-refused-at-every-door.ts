// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #35228 ruling A, with #35608 folded in. An accept-set narrowing of the stack
// aggregate and of composition: the same-package identity check that
// stack-collection-duplicate-entry-refused added for one stack now also runs on
// the one package a flat composition makes of its inputs and on every package
// body, with the same wording. No D2 conversion: which entry keeps the
// identity, and what a second extension of one object becomes, is the
// author's call. An artifact built before this keeps loading, with an error
// line naming the entries (runtime arm A1).
export const entry: SemanticMigration = {
  id: 'stack-package-duplicate-entry-refused-at-every-door',
  surface:
    'composeStacks inputs of one package, and every packages[i].manifest body — two or more entries under '
    + 'one identity in one of the named collections stack-collection-duplicate-entry-refused lists (objects, '
    + 'datasources, pages, … , queues, assignmentRules, apps and objectExtensions), e.g. two sub-stacks of one '
    + "package that each declare objectExtensions: [{ extend: 'crm_line', fields: { ... } }]",
  replacement:
    'One entry per identity per package, wherever the package is assembled: in one stack, across the '
    + 'sub-stacks a composition folds into one package (every manifest strategy except preserve), and inside '
    + 'each packages[i] body. Merge the two entries into one (for objectExtensions: one entry per target '
    + 'object carrying all the fields), or rename one of them. Two packages reusing one name, under '
    + 'manifest preserve or as two package bodies, are unchanged, as is the same built sub-stack passed to '
    + 'a composition twice.',
  reason:
    'The runtime keeps one entry per identity per package. For objectExtensions a later entry of one '
    + 'package replaces the earlier one for its target, so only the last entry\'s fields register; for the '
    + 'other collections the boot keeps one entry, as the single-stack refusal records. A single stack was '
    + 'refused already, but two sub-stacks of one package that each declared one entry under one identity '
    + 'composed with both entries, and a hand-built package body carrying two was accepted: objectstack '
    + 'validate, objectstack build and the boot all passed, and an extension\'s earlier fields were then '
    + 'missing at runtime, where reads and writes naming them answered INVALID_FIELD. The composition and '
    + 'the package body now refuse the pair in the same cross-reference envelope (STACK_CROSS_REFERENCE_INVALID), '
    + 'with the single-stack wording and the place of each entry: the input it came from for a composition, '
    + 'stack.packages[i].manifest.KEY[j] for a package body. A package built before this change still loads '
    + 'with its old outcome, and its registration logs an error naming the target, the package and the '
    + 'entries until it is rebuilt.',
  acceptanceCriteria:
    'objectstack validate and objectstack build load the composed stack without a STACK_CROSS_REFERENCE_INVALID '
    + 'finding of the form "X is declared twice in KEY: …", and the boot log carries no error saying a package '
    + 'declares several objectExtensions entries for one object. After merging, check that every field of '
    + 'every former entry is served on the target object (the boot used to serve only the last entry\'s '
    + 'fields), and for the other collections that the entry you kept is the one the runtime now serves.',
};
