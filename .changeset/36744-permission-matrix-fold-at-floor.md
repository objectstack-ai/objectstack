---
'@object-ui/app-shell': patch
---

fix(studio): the permission matrix draws its flat form only where it fits, so the bulk column no longer covers 「写入范围」

Clause-②: no
Metadata-protocol: none

The Studio Objects permission matrix switched to its full flat form at a 1000 px pane, but the flat table needs 1304 px. Between the two (a 1440 px window gives a 1200 px pane) the table overflowed, and the right-pinned bulk column sat over the write-scope column with nothing to show the pane scrolled sideways.

The fold width is now the flat table's floor, 1304 px, so one number decides both. Narrower panes get the folded form (the four CRUD boxes, each row's "More permissions", and the "Bulk" menu); 1304 px and wider get the flat form, which always fits. A test pins the fold width equal to the floor.
