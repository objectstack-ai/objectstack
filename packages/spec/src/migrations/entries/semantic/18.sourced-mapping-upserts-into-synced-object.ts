// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A mapping that pulls (a connectorSource, or the new datasourceSource) now
// writes in upsert mode with a key, into an object declared managedBy synced.
// A structured TODO, not a D2 conversion: which column is the key, and
// whether members were meant to edit the pulled rows, is intent no artifact
// records.
export const entry: SemanticMigration = {
  id: 'sourced-mapping-upserts-into-synced-object',
  surface:
    'data.Mapping with a connectorSource (or a datasourceSource) — parsed by MappingSchema and judged '
    + 'by defineStack: the mapping now declares mode upsert with a non-empty upsertKey, carries at '
    + 'most one source, and its targetObject is an object of the stack declared managedBy synced. '
    + 'And data.Object with managedBy synced: userActions may not open create, import, edit or delete',
  replacement:
    'mode: \'upsert\' and upsertKey naming the target field that carries the source key (the field '
    + 'the source id is mapped onto, such as external_id) on the mapping, and managedBy: \'synced\' '
    + 'with a declared sharingModel (public_read is recommended: a pulled row has no person owner) '
    + 'on the target object. Drop any userActions entry that opens a write on it; a change to the '
    + 'data belongs in the source, through a declared action that calls it',
  reason:
    'A pull is one-way: each run writes the source\'s copy of a row over the local copy. A sourced '
    + 'mapping in insert mode duplicated every row on every run, and update mode never created the '
    + 'rows; an upsert with no key matched nothing. A pull into an ordinary object left its rows '
    + 'editable by members, and the next pull kept or overwrote an edit with no word: the synced '
    + 'bucket (ADR-0153 D4) holds the rows read-only to members through every guard a managed bucket '
    + 'has (the engine write guard, the apiMethods reconciliation, the permissions clamp), and '
    + 'userActions, which reopens a verb on every other bucket, cannot reopen one here (a named '
    + 'exception to ADR-0103 D1). Each rule is refused where it is written: the mode, the key and '
    + 'the single source at parse, the target at defineStack. ADR-0049 / ADR-0087 / ADR-0153.',
  acceptanceCriteria:
    'Run os validate (or defineStack) over every stack that declares a mapping with a source. Done '
    + 'when each such mapping parses with mode upsert and an upsertKey, names one source, and its '
    + 'target object declares managedBy synced with a sharingModel and no userActions entry that '
    + 'opens a write.',
};
