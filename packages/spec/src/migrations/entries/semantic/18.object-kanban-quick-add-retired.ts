// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #17260 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `object-kanban-quick-add-removed` family (ruling B on #17152: one D3 entry
// per retirement family, even when D2 is lossless). The strip changes nothing a
// user sees; the decision it leaves is whether the board needed the control
// the author asked for.
export const entry: SemanticMigration = {
  id: 'object-kanban-quick-add-retired',
  surface: 'page.component.object-kanban.quickAdd — the per-column quick-add switch on the '
    + 'metadata-driven board',
  replacement: '(removed from the metadata board.) Delete the key; `object-kanban` offers no '
    + 'quick-add control. On a metadata board, records are created through the object\'s ordinary '
    + 'create action.',
  reason: 'The D2 conversion `object-kanban-quick-add-removed` deletes `quickAdd` from every '
    + '`object-kanban` component, and the delete is lossless: the board forwarded the flag, but the '
    + 'control also needs a host-supplied `onQuickAdd` function that JSON cannot carry and no '
    + 'producer ever put on an object-kanban node, so the gate was permanently false and no board '
    + 'ever showed the control. The residue is the requirement behind the flag. An author who set '
    + '`quickAdd: true` wanted users to add a card inside a column; that never happened and still '
    + 'does not. Whether the board can live without it is a product decision about that board — '
    + 'not something a key delete can make.',
  acceptanceCriteria: 'No `object-kanban` component carries `quickAdd`; the parse refuses it. Each '
    + 'board renders the same columns and cards as before the upgrade. For each board that had set '
    + 'the flag, the author has accepted creating records through the object\'s create action: '
    + '`object-kanban` offers no quick-add control.',
};
