---
'@object-ui/components': patch
'@object-ui/i18n': patch
'@object-ui/plugin-grid': patch
---

feat(components): in a list's grid a read-only cell says it is read-only, a cell save is said in one live region, and a touch never edits a cell in place

Clause-②: yes (widening)
Metadata-protocol: none

The widening is additive: the new key `table.cellSavedAnnouncement` in every locale pack `@object-ui/i18n` publishes through `./locales`.

- **Read-only cells.** When the data table is a grid (`role="grid"`: a list page with the select-first cell model, or `keyboardNavigation`), a cell that opens no editor carries `aria-readonly="true"`, and so does the focus inside the selected cell, so a screen reader says "read only" on the cell it moves to. The selected cell adds the host's own facts (`GridCellSelection.describeCell`), asked as it becomes selected and again only when the row is re-read or the host hands a new value, never on each render; the rest read the table's own (`editable`, the column, the row). A plain table carries no `aria-readonly`. In a list, an approval lock or an update verdict that answers after the cell was selected is said on that cell at once, without the reader moving: the lock read re-renders the grid when it answers, and the grid hands the table a new value only when what its cell facts read changed.
- **Save results.** A table that saves each cell (`GridCellSelection` with `onRowSave`) draws one visually hidden polite live region for its whole life and says each saved cell there, by column name ("Saved: Amount"; new pack key `table.cellSavedAnnouncement`, in all eleven locales). Cells saved together are joined in the locale's list punctuation (`validation.formInvalidJoiner`: `、` in ja and zh); a column with no header is never named by its key (the region says "Saved"). A refused save is said once, by the cell's existing alert. The cell's saving/saved mark is no longer a live region of its own (it was mounted with its words and announced unreliably); it stays a named image.
- **Touch.** A tap on a cell that is not selected never edits in place: a lookup cell's edit button is not drawn for a finger, and a tap that lands on one drawn earlier for a mouse does nothing (the row ignores a click on a button). A tap elsewhere on the cell still opens the record, which is where a touch edits. A later click on the button with no pointer of its own (assistive tech) edits as before.
