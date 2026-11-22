---
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
---

feat(grid): a markdown, HTML or rich text cell opens a text box in a panel under the cell

Clause-②: yes (widening)
Metadata-protocol: none

**The list grid edits the rich-content field types in place** (objectstack#36023). On a select-first grid, selecting a `markdown`, `html` or `richtext` cell and pressing Enter, F2, typing or double-clicking opens the record form's own text box over the stored source in a panel under the cell, at least as wide as the column; the cell keeps showing its value and the row keeps its height. Enter in the panel is a new line; on a select-first grid Ctrl/Cmd+Enter saves and keeps the cell selected, Esc discards, and a click outside saves. Backspace or Delete on the selected cell of a select-first grid clears it as for any other editable cell. On a grid without the select-first cell model (an `ObjectGrid` or `object-grid` mounted without `cellSelection`), one click opens the text box over the cell, not in a panel under it: Enter is a new line, Ctrl/Cmd+Enter does nothing, Esc discards, and a click outside keeps the text as a pending change for the grid's save buttons. Before, these cells opened no editor and said "This field can't be edited in a list". The related tab on the record page draws the same grid and behaves the same way.

**Only the grid's cell changes.** The three types stay in `INLINE_EXCLUDED_FIELD_TYPES`, and `hasFieldEditWidget` and `isInlineExcludedFieldType` answer as before, so the record page's field editor, the required-fields dialogs, the kanban and timesheet editors keep them out. `@object-ui/fields` exports `hasInCellPanelEditWidget(type)`, true for the three types, and `FieldEditWidget` draws their editor only when the host asks for the cell face (`inCell`); the editor loads lazily. `html` is edited as text; what the cell then draws goes through the sanitizing HTML renderer, as on every other read surface.
