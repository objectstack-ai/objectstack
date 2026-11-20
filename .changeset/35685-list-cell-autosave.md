---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
'@object-ui/react': patch
'@object-ui/plugin-list': patch
---

feat(list): a list cell saves the moment it is committed, and Space types into the selected cell

Clause-②: yes (widening) — new members on the `@object-ui/react` package entry: `createOwnWrites`, `OwnWritesContext`, `useOwnWrites` and the `OwnWrites` type, and an optional third parameter on `useDataInvalidation`; nothing removed or renamed
Metadata-protocol: none

In a grid that mounts `GridCellSelection` (the select-first grid every `ListView` draws), a committed cell edit is now saved at once, as one update for that record:

- **No save bar, no row Save/Cancel column, no amber row.** The cell shows a small spinner while the save runs and a check mark once it landed.
- **Only that row is redrawn**, from the record the write answered with, so a value a server hook rewrote shows as stored. The list is not read again, though the write is still announced to every other reader (the record's detail pane, related lists, counts): the grid holds the record in the list's `OwnWritesContext` registry for the length of its write, and `ListView` lets that one write go by. So a row whose new value would sort it elsewhere stays where it is until the next load (refresh, sort, filter or page change). The counts on group headers, read with the rows, follow on the next load too; the footer's whole-set summary is its own reader and still refreshes on the write.
- **A refused save keeps the typed value** and shows the server's reason on the cell. Esc puts the stored value back. Later edits on the same row are sent together with the refused one as one update. When the reason names a field the list does not show (a rule that needs another field), the notice offers to open the record.
- **The 409 conflict dialog is unchanged.** The next save on a row sends the version the previous save answered.
- **Space** on a selected cell now types a space and opens its editor, as any other key does. A two-state (boolean) cell still flips. The record opens from the title link or a touch tap; the "Space opens the record" key added in #35747 is gone, so a master-detail page opens its pane only that way too.

`@object-ui/react` adds that registry: `createOwnWrites()`, `OwnWritesContext` / `useOwnWrites()`, and `useDataInvalidation(objectName, recordId, ownWrites)`, which skips a change naming a held record.

Grids without `GridCellSelection` keep the staged save bar and its batch save unchanged.

New `table.*` strings in every locale: `cellSaving`, `cellSaved`, `openRecordToFinish`.
