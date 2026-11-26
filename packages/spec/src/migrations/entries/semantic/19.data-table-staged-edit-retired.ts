// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The data-table staged-edit retirement (ruling record 7178367040, route A: the
// staged model and its interface retire together), its D3 entry. No D2
// conversion: nothing it retires is authorable metadata (`onBatchSave` is a
// host function the parse already refused by name, and `cellSelection` is a
// React prop of `<ObjectGrid>`), so there is no source to rewrite. What the
// consumer still owes is the host code and the tests that drove the old model.
export const entry: SemanticMigration = {
  id: 'data-table-staged-edit-retired',
  surface: 'object-grid / data-table host interface — the staged edit model: `<ObjectGrid cellSelection={false}>`, '
    + 'the `onBatchSave` handler on `<ObjectGrid>` and on the `data-table` schema, `data-table`\'s '
    + '`singleClickEdit`, and an editable `data-table` mounted without a cell-selection host or an '
    + '`onRowSave` handler',
  replacement: 'Select-first editing with one save per committed cell. Pass `onRowSave` to `<ObjectGrid>` to own '
    + 'persistence record by record, or pass nothing and let the grid write through its own '
    + '`dataSource.update`. A host may still pass `cellSelection={true}`; without the prop an editable grid '
    + 'is select-first and a read-only grid opens a record on a click. A bare `data-table` edits only '
    + 'inside a cell-selection host with an `onRowSave` handler, or is rendered as `object-grid` instead.',
  reason: 'The staged model kept edited cells as pending changes behind a "Save All" bar and handed them to '
    + '`onBatchSave` together. It is gone, not deprecated: `cellSelection` accepts only `true`, `onBatchSave` '
    + 'is a `never` key on both type faces and refused by name in the parse, and `singleClickEdit` is no '
    + 'longer declared. A host that passed `cellSelection={false}` to get click-to-edit and a save bar now '
    + 'gets select-first editing that saves each cell as it is committed, so a batch handler it relied on '
    + 'for one transaction per save is never called. An editable `data-table` without a cell-selection host '
    + 'and an `onRowSave` handler now renders read-only and logs a console warning instead of staging edits '
    + 'it had nowhere to save. Only the host\'s author can tell whether per-record saves are acceptable where '
    + 'a batch was, and which help text and tests describe the old gestures.',
  acceptanceCriteria: 'No host passes `cellSelection={false}` or an `onBatchSave` handler, and no `data-table` '
    + 'schema carries `singleClickEdit` or `onBatchSave`; the type check refuses all of them. Every editable '
    + 'grid either passes `onRowSave` or relies on its data source to save each committed cell, and its help '
    + 'text and tests describe a click that selects a cell, a double-click, Enter, F2 or typing that opens its '
    + 'editor, and no "Save All". No editable `data-table` logs the read-only warning at mount.',
};
