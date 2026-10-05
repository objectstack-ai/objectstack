// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A write-door answer and verdict, not an authorable key: there is no D2
// conversion and nothing for `objectstack migrate meta` to rewrite. The entry
// carries the changed answer to the one reader the ledger serves here — the
// upgrade guide — because a client that branched on the old 403 has no schema
// error to find it by. No backticks in `surface`: the upgrade guide renders it
// inside a code span and a table cell.
export const entry: SemanticMigration = {
  id: 'by-id-write-unreadable-row-not-found',
  surface:
    'the data write doors — a by-id update or delete of a row the caller cannot read, on every '
    + 'object and for every principal',
  replacement:
    'read 404 `RECORD_NOT_FOUND` on a by-id update or delete as "no row you can see has this id" — '
    + 'the read door\'s meaning — and keep a 403 for a row the caller can read but may not write',
  reason:
    'A WRITE-DOOR ANSWER, made one with the read door\'s. A by-id update or delete of a row the '
    + 'caller cannot read used to answer a 403 — `PERMISSION_DENIED` where a write-class row filter '
    + 'binds the caller, otherwise a later gate\'s own 403, such as `FORBIDDEN` from record sharing '
    + 'or a parent-derived gate\'s code on attachments and comments — while an id that names no row '
    + 'answered 404, so the write door told a hidden row apart from a missing one. The by-id write '
    + 'pre-image check now asks every principal whether it can read the row it addressed, through '
    + 'a by-id read in its own context that every data middleware\'s visibility applies to, and '
    + 'answers a row that read does not return with the read door\'s not-found: the same code, '
    + 'status and body a nonexistent id gets. It also refuses a by-id write a principal no row '
    + 'filter binds could previously land on a row hidden from it, such as an attachment\'s '
    + 'uploader or a comment\'s author whose parent record they can no longer read. A caller who '
    + 'can read the row but may not write it keeps its 403. Writes the platform issues under the '
    + 'caller\'s context — the engine\'s cascade delete, a hook\'s write, the referential clear of a '
    + 'lookup — keep their previous answer, and writes not routed by id are unchanged.',
  acceptanceCriteria:
    'Every client that handles a by-id update or delete treats 404 `RECORD_NOT_FOUND` as "not '
    + 'found or not visible" and no longer reads a 403 there as proof the row exists; an operator '
    + 'who needs a user to write a row grants that user read access to it first.',
};
