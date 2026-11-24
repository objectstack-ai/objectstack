---
'@object-ui/plugin-grid': patch
---

fix(grid): undoing an earlier cell save right after a newer save of the same row keeps the newer save on screen

Clause-②: no
Metadata-protocol: none

In a select-first grid, the Undo of an earlier save (its toast's Undo, or Ctrl+Z / Cmd+Z) draws its answer over the row as the grid shows it now. If that Undo arrived in the short window after a newer save of the same record was drawn, but before React ran that render's effects, the grid read the older patch. The row then dropped back to the values it was first read with, for example the name before the newer save, until the next load. The server's record was right the whole time. The patches the Undo reads now move together with the save that writes them, so an Undo pressed at any moment draws over the newest save.
