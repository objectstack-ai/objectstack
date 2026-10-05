// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A write-door answer, not an authorable key: there is no D2 conversion and
// nothing for `objectstack migrate meta` to rewrite. The sibling of
// `18.by-id-write-unreadable-row-not-found`, for the predicate door. The entry
// carries the changed answer to the one reader the ledger serves here — the
// upgrade guide — because a caller that branched on the old answer has no
// schema error to find it by. No backticks in `surface`: the upgrade guide
// renders it inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'predicate-write-unreadable-row-not-matched',
  surface:
    'the data write doors — a predicate-scoped (multi) update or delete, on every object and for '
    + 'every principal',
  replacement:
    'read a predicate update or delete as reaching only the rows the caller can read: the result '
    + 'counts those rows alone, a predicate that reaches only hidden rows succeeds with zero rows, '
    + 'and a predicate whose readable match exceeds one write\'s row ceiling is refused with 400 '
    + '`INVALID_FILTER` — narrow it and write in batches',
  reason:
    'A WRITE-DOOR ANSWER, made one with the read door\'s, on the predicate door as on the by-id '
    + 'door. The rows a predicate update or delete matched came from its write scope alone, so a '
    + 'row the caller cannot read was matched whenever that scope reached it: a per-row gate then '
    + 'refused the write with a 403, or the row was written and counted. Either answer told a '
    + 'hidden row apart from no row. The write middleware now asks the read door which rows the '
    + 'caller\'s own predicate returns — a read in the caller\'s context that every data '
    + 'middleware\'s visibility applies to — and narrows the matched set to them, so a row the '
    + 'caller cannot read is not written, not counted and not refused. A read the read door '
    + 'refuses keeps the write\'s previous answer, and a readable match larger than one predicate '
    + 'write\'s row ceiling is refused rather than cut off. A caller who can read a matched row but '
    + 'may not write it keeps its answer. Writes the platform issues under the caller\'s context — '
    + 'a cascade, a hook\'s own write, the referential clear of a lookup — keep their previous '
    + 'answer, and by-id writes are unchanged.',
  acceptanceCriteria:
    'Every caller that issues a predicate update or delete reads its count as the rows it can see '
    + 'and no longer reads a 403 there as proof a hidden row matched; an operator who needs a user '
    + 'to change rows grants that user read access to them first; a predicate whose readable match '
    + 'exceeds the row ceiling is narrowed and written in batches.',
};
