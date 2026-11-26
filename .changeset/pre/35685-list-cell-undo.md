---
'@object-ui/plugin-grid': patch
'@object-ui/react': patch
---

feat(list): undo a list cell save from its toast or with Ctrl+Z

Clause-②: yes (widening) — `toastRecordSave` in `@object-ui/react` takes an optional fourth argument, an `action` button the toast carries (new exported type `RecordSaveToastAction`), and `RecordSaveSink`'s options accept that `action`; nothing removed or renamed
Metadata-protocol: none

In a grid that mounts `GridCellSelection` (the select-first grid every `ListView` draws), a landed cell save can be taken back:

- **The save toast has an Undo button**, and **Ctrl+Z** (Cmd+Z on macOS) on a cell of the grid undoes the newest save, then the one before it. Each save is taken back once.
- **An undo is a new update, not a local rollback.** It writes the value each saved field held before the save (a relation as its stored id), with the version this grid's own newest write of the record answered as `If-Match`, so a change someone else made since answers 409 and opens the same conflict dialog as a save instead of being overwritten. A refused or cancelled undo is used up; the next Ctrl+Z undoes the save before it. The server's history records the save and its undo as two changes. Only the row is redrawn, as for a save.
- Inside an open editor Ctrl+Z stays the editor's own text undo. On a cell, the grid's key is handled by the grid alone: the console's shared Ctrl+Z undo stack is not popped by it.
- A save of a field the row did not read offers no Undo, rather than a partial one.

A grid without `GridCellSelection` (a related list in a record drawer, for one) now re-reads on every write of its object again, including a write the list around it draws itself: before, it skipped the writes that list held while they ran.
