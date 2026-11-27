// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of the metadata writes that name no package, not of any key:
// ADR-0150 D3 (its 2026-11-26 note) has a package-less row stored at a name a
// package holds hide with that holder: the reads withhold it, and the writes
// naming no package leave it alone. While every holder of the name is
// disabled, the save, the draft save, the delete, the draft discard, the
// per-item publish and the per-item rollback naming no package are refused
// where the ADR-0146 D11 close leaves them open. Each answered 200 there and
// edited, stored, removed, promoted into or restored a row no read served;
// where a code package ships the name, the draft discard over a stored row
// with no draft already answered 409, and only its sentence moves. No key is
// added, removed or re-shaped and no stored row changes shape, so no tombstone
// and no D2 conversion: whether to enable the holder again is the operator's
// judgement. No relevance question: the move turns on which installed packages
// are disabled, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'disabled-holder-package-less-row-bare-write-refused',
  surface:
    'A write of a metadata item that names no package (PUT /api/v1/meta/TYPE/NAME in publish mode and with '
    + '?mode=draft, DELETE /api/v1/meta/TYPE/NAME, its draft discard with ?state=draft, and the in-process save '
    + 'and delete of a metadata item with no packageId; POST /api/v1/meta/TYPE/NAME/publish and '
    + 'POST /api/v1/meta/TYPE/NAME/rollback, and the in-process publishMetaItem and rollbackMetaItem with no '
    + 'packageId), for a name held only by installed packages that are '
    + 'disabled, of a type the registry reads by package, while a package-less row or a package-less draft is '
    + 'stored for that name. Where the package-less write onto a packaged item was already closed (ADR-0146 D11: '
    + '403 NOT_OVERRIDABLE for the save, the delete, the publish and the rollback), only the draft discard moves',
  replacement:
    'Enable a package that holds the name (PATCH /api/v1/packages/ID/enable; GET /api/v1/packages shows which '
    + 'packages are disabled), then send the same write again: it edits, drafts, removes, publishes or rolls back '
    + 'the package-less row as it did before. While every holder stays disabled the write answers 409 RESOURCE_CONFLICT and stores, edits '
    + 'and removes nothing. Naming the package on the write (?package=ID) is not the fix: it addresses that '
    + 'package\'s own row, so it leaves the hidden row where it is and stores a second row beside it. An item the '
    + 'ADR-0146 D11 close covers (one read-only code package ships it, with a pair, and os migrate '
    + 'packageless-overlays would move its row) is the exception this entry does not change: its save, its '
    + 'delete, its publish and its rollback naming no package answer that close first, 403 NOT_OVERRIDABLE with that close\'s own remedy, with '
    + 'the package enabled or disabled; there only the draft discard answers this 409.',
  reason:
    'A package-less row stored at a name a package holds is that package\'s customization, never a second item, '
    + 'and a disabled package\'s items are withheld from every read that names no package. The writes that name no '
    + 'package still reached the row: the save edited it unseen, the draft save stored a draft the draft read then '
    + 'answered 404 for, the draft discard removed it, the delete removed the row, the publish promoted a draft '
    + 'into it and the rollback rewrote it, so enabling the package again served its item without the '
    + 'customization, or with a body nobody saw land. They now judge the name\'s holders past a stored '
    + 'package-less row, as they already did with none stored. A name no package holds, a package-less row at a '
    + 'name an enabled package holds, and a name only disabled packages hold with no package-less row stored (its '
    + 'refusal keeps the ?package= remedy) answer as before. There is no mechanical rewrite: whether the disabled '
    + 'package should be enabled again is a judgement about the deployment.',
  acceptanceCriteria:
    'For every name whose holders are all disabled and for which a package-less row or draft is stored, where the '
    + 'ADR-0146 D11 close leaves the package-less write open: PUT /api/v1/meta/TYPE/NAME (publish mode and '
    + '?mode=draft), DELETE /api/v1/meta/TYPE/NAME (and ?state=draft), POST /api/v1/meta/TYPE/NAME/publish and '
    + 'POST /api/v1/meta/TYPE/NAME/rollback naming no package answer 409 '
    + 'RESOURCE_CONFLICT and leave every stored row of the name byte-identical. Where that close applies, the '
    + 'draft discard answers the same 409, and the save, the draft save, the delete, the publish and the rollback '
    + 'answer 403 NOT_OVERRIDABLE '
    + 'as they did before, storing nothing. Once a holder is enabled again, the read naming no package serves the '
    + 'package-less row as it was stored, and the same writes answer as they did before the disable.',
};
