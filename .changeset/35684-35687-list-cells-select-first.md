---
'@object-ui/components': minor
'@object-ui/core': minor
'@object-ui/plugin-grid': minor
'@object-ui/plugin-list': minor
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
---

feat(list): a list's cells are selected by a click and edited by a double-click, Enter or typing, with no inline-edit toggle

Clause-②: yes (widening)
Metadata-protocol: semantic
Skills-docs: none — `skills/objectstack-ui/rules/list-views.md` already teaches that inline editing is on by default for a user who may update the object, with `userActions: { editInline: false }` as the opt-out, which the list page now does with no toggle; no skill teaches the toggle or a single-click edit.

**The list page (`ListView`) has no inline-edit mode and no toggle.** Its grid is editable in place wherever the reader may update the object and the view does not declare `userActions.editInline: false`; a view's boolean `inlineEdit` still folds into that switch, so `inlineEdit: false` reads off and `inlineEdit: true` reads on. Before, a view that declared neither opened read-only with an "Edit inline" toggle in the toolbar and in the Display menu, the mode lasted for the session, and a click on a cell edited it. Both toggles are gone, and `ListViewProps.onInlineEditChange` is deprecated and never called; the console stops passing it.

**The select-first cell model** (`data-table`, behind the new `GridCellSelectionProvider` in `@object-ui/components`; `ObjectGrid` mounts it when its host passes the new `cellSelection` prop, and the list page does):

- A click selects a cell (a ring around it) and neither edits it nor opens the record. A link the cell draws (the name, a lookup, a phone or an email) keeps its own click. A touch tap opens the record and never edits in place.
- Double-click, Enter or F2 edits, keeping the value with the caret at its end; typing a character replaces the value with it (a picker or a date opens instead); Backspace or Delete opens an empty editor and saves nothing.
- While editing, Enter commits and moves down, Tab and Shift+Tab commit and move right and left, Escape cancels and keeps the cell selected; in a multi-line editor Enter is a new line and Ctrl/Cmd+Enter commits. Commits are the grid's staged edits, saved by the row's Save and Save All as before.
- On the selected cell the arrows and Tab move the selection, Space opens the record (a checkbox cell flips and commits instead, as a second click on it does), Ctrl/Cmd+C copies, Ctrl/Cmd+V converts the text to the field's type and commits it, and Escape clears the selection.
- An input method's composition is kept whole: keys pressed while composing, and the 229 Enter Safari raises after it, never commit, cancel or move, and a composition started on a selected cell opens the editor with the composed text. This guard applies to every `data-table` editor.
- A cell that opens no editor says why on the cell: the field is read-only, calculated or not editable in a list, the reader may not edit the field, these records or this record, the view turned editing off, or the record is locked by an approval. The approval lock is read from the approvals service's per-record lock when a cell of the row is selected, through the record page's rule (`resolveApprovalLock`), with the row's `approval_status` standing in until it answers.

A grid outside the list page, which mounts no provider, keeps its click-to-edit (`singleClickEdit`) and click-to-open behaviour unchanged.

On the list page the table's trailing edit column, which holds a changed row's Cancel and Save, is drawn only while a row has changes, so the list at rest ends on its last data column. `@object-ui/core` exports `resolveAffordanceGrant`, the grant half of `resolveAffordance`, which the list cell's read-only reason reads.

New locale keys, in every pack: `table.cellReadOnly` and `grid.readOnlyReason.*` (nine reasons). No key is removed: `list.inlineEditShort` and `list.inlineEditLabel`, the toggle's words, stay in every pack, though the list no longer draws the toggle.
