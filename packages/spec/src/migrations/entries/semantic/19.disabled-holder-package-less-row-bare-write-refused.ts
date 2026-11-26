// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the metadata writes that name no package, not of any key:
// ADR-0150 D3 (its 2026-11-26 note) has a package-less row stored at a name a
// package holds hide with that holder, on the writes as on the reads. While
// every holder of the name is disabled, the save, the draft save, the delete
// and the draft discard naming no package are refused, where each answered 200
// and edited, stored or removed a row no read served. No key is added, removed
// or re-shaped and no stored row changes shape, so no tombstone and no D2
// conversion: whether to enable the holder again is the operator's judgement.
// No relevance question: the move turns on which installed packages are
// disabled, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'disabled-holder-package-less-row-bare-write-refused',
  surface:
    'A write of a metadata item that names no package (PUT /api/v1/meta/TYPE/NAME in publish mode and with '
    + '?mode=draft, DELETE /api/v1/meta/TYPE/NAME, its draft discard with ?state=draft, and the in-process save '
    + 'and delete of a metadata item with no packageId), for a name held only by installed packages that are '
    + 'disabled, of a type the registry reads by package, while a package-less row or a package-less draft is '
    + 'stored for that name',
  replacement:
    'Enable a package that holds the name (PATCH /api/v1/packages/ID/enable; GET /api/v1/packages shows which '
    + 'packages are disabled), then send the same write again: it edits, drafts or removes the package-less row as '
    + 'it did before. While every holder stays disabled the write answers 409 RESOURCE_CONFLICT and stores, edits '
    + 'and removes nothing. Naming the package on the write (?package=ID) is not the fix: it addresses that '
    + 'package\'s own row, so it leaves the hidden row where it is and stores a second row beside it.',
  reason:
    'A package-less row stored at a name a package holds is that package\'s customization, never a second item, '
    + 'and a disabled package\'s items are withheld from every read that names no package. The writes that name no '
    + 'package still reached the row: the save edited it unseen, the draft save stored a draft the draft read then '
    + 'answered 404 for, the draft discard removed it, and the delete removed the row, so enabling the package '
    + 'again served its item without the customization. They now judge the name\'s holders past a stored '
    + 'package-less row, as they already did with none stored. A name no package holds, a package-less row at a '
    + 'name an enabled package holds, and a name only disabled packages hold with no package-less row stored (its '
    + 'refusal keeps the ?package= remedy) answer as before. There is no mechanical rewrite: whether the disabled '
    + 'package should be enabled again is a judgement about the deployment.',
  acceptanceCriteria:
    'For every name whose holders are all disabled and for which a package-less row or draft is stored: PUT '
    + '/api/v1/meta/TYPE/NAME (publish mode and ?mode=draft) and DELETE /api/v1/meta/TYPE/NAME (and ?state=draft) '
    + 'naming no package answer 409 RESOURCE_CONFLICT and leave every stored row of the name byte-identical; once '
    + 'a holder is enabled again, the read naming no package serves the package-less row as it was stored, and '
    + 'the same writes answer as they did before the disable.',
};
