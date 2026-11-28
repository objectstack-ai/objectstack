---
'@object-ui/fields': patch
'@object-ui/components': patch
'@object-ui/types': patch
---

fix(ui): the rich-text cell text, the read-only `data-table` warning and the `onBatchSave` refusal describe the one editing model the grid has

Clause-②: no
Metadata-protocol: none

The list grid has one way to edit: select-first, each committed cell saved at once. Three shipped texts still described the retired staged model or named the wrong thing to mount.

- **`@object-ui/fields`.** The README's "grid cell editor's face" section and the `FieldEditWidget` comment on the rich-content cell panel no longer say that a grid without `cellSelection` opens the `markdown`, `html` or `richtext` box over the cell and keeps its text for the grid's save buttons. The grid edits only in its select-first model, and it opens the box in a panel under the cell: Enter is a new line, Ctrl/Cmd+Enter or a click outside saves, Esc discards.
- **`@object-ui/components`.** The console warning for an editable `data-table` that renders read-only now tells the host to mount `GridCellSelectionProvider`. It named `GridCellSelection`, which is the context's value type and cannot be mounted. The table's host-injected cell editor no longer checks for the select-first model on each key, because an editor only opens inside that model. Tab and Ctrl/Cmd+Enter behave as before.
- **`@object-ui/types`.** The `data-table` schema's refusal of `onBatchSave` names its successor: `onBatchSave` → `onRowSave` on `object-grid`. Render an `object-grid`, which writes each committed cell through its data source, or pass `onRowSave` inside a `GridCellSelectionProvider` from a React host, and delete the key. It used to point the author at a toast or an `action:button` node. The key is refused exactly as before.

Nothing to migrate.
