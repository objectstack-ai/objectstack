---
'@object-ui/plugin-grid': patch
---

fix(grid): an Undo pressed the moment a list reload lands draws its answer over the new load's row

Clause-②: no
Metadata-protocol: none

In a select-first grid, the Undo of a cell save (its toast's Undo, or Ctrl+Z / Cmd+Z) draws its answer over the row as the grid shows it now. If that Undo arrived in the short window after a reload's rows were drawn, but before React ran that render's effects, the grid looked the record up among the previous load's rows. The answer was then tied to a row no longer on screen, so the cell kept the value the Undo had just taken back until the next load. The server's record was right the whole time. The rows an Undo reads are now set in the same render that draws them, so an Undo pressed at any moment draws over the rows on screen.
