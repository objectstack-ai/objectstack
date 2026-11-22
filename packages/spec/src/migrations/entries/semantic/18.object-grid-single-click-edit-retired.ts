// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #36270 (ADR-0049 enforce-or-remove) — the D3 entry of the
// `object-grid-single-click-edit-removed` family (one D3 entry per retirement
// family, even when D2 is lossless). The conversion deletes the key; what it
// cannot decide is whether a grid that relied on the single-click entry still
// edits the way its users expect.
export const entry: SemanticMigration = {
  id: 'object-grid-single-click-edit-retired',
  surface: 'page.component.object-grid.singleClickEdit — the switch between opening a cell editor on a '
    + 'single click and on a double click',
  replacement: 'None to author. A grid that renders editable (`editable: true` and the viewer allowed to '
    + 'edit) selects a cell on a click and opens its editor on double-click, Enter, F2 or typing; each '
    + 'committed cell is saved on its own.',
  reason: 'The D2 conversion `object-grid-single-click-edit-removed` deletes the key, whatever its value, '
    + 'and that is lossless for the parse: no value can be honoured under the select-first model. The '
    + 'judgment sits with the users of the grid. A grid that authored `true`, or left the key to the '
    + 'renderer\'s default of `true`, used to open an editor on the first click and saved every edit '
    + 'together through a "Save All" bar; it now takes a second gesture to open the editor and saves each '
    + 'cell at once. Help text, training material or tests that describe the old gestures must change, '
    + 'and only the author can find them. The same change makes arrow-key navigation always on for an '
    + 'editable grid, so a `keyboardNavigation: false` on one no longer turns it off. Code that builds '
    + 'object-grid props (a host, a generator) must also stop emitting the key, which no conversion '
    + 'reaches.',
  acceptanceCriteria: 'No `object-grid` component carries `singleClickEdit`; the parse refuses it. Every '
    + 'editable grid\'s help text and tests describe a click that selects a cell and a double-click, '
    + 'Enter, F2 or typing that opens its editor, with each cell saved on its own and no "Save All". No '
    + 'editable grid relies on `keyboardNavigation: false` to keep its cells separate Tab stops.',
  conversionIds: ['object-grid-single-click-edit-removed'],
};
