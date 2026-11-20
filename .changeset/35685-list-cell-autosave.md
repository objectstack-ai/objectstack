---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(list): a list cell saves the moment it is committed, and Space types into the selected cell

Clause-②: no
Metadata-protocol: none

In a grid that mounts `GridCellSelection` (the select-first grid every `ListView` draws), a committed cell edit is now saved at once, as one update for that record:

- **No save bar, no row Save/Cancel column, no amber row.** The cell shows a small spinner while the save runs and a check mark once it landed.
- **Only that row is redrawn**, from the record the write answered with, so a value a server hook rewrote shows as stored. The grid is not read again, so a row whose new value would sort it elsewhere stays where it is until the next load (refresh, sort, filter or page change). Footer summaries and group totals also follow on the next load.
- **A refused save keeps the typed value** and shows the server's reason on the cell. Esc puts the stored value back. Later edits on the same row are sent together with the refused one as one update. When the reason names a field the list does not show (a rule that needs another field), the notice offers to open the record.
- **The 409 conflict dialog is unchanged.** The next save on a row sends the version the previous save answered.
- **Space** on a selected cell now types a space and opens its editor, as any other key does. A two-state (boolean) cell still flips. The record opens from the title link or a touch tap; the "Space opens the record" key added in #35747 is gone, so a master-detail page opens its pane only that way too.

Grids without `GridCellSelection` keep the staged save bar and its batch save unchanged.

New `table.*` strings in every locale: `cellSaving`, `cellSaved`, `openRecordToFinish`.
