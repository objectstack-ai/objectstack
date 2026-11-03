---
'@object-ui/app-shell': patch
---

fix(app-shell): the permission matrix's field Read and Edit boxes stay reachable while the matrix scrolls sideways

Clause-②: no
Metadata-protocol: none

The permission matrix has a 1304 px floor, so a narrower pane scrolls sideways. Under an expanded object, the field sub-table's name column was its flexible column (about 697 px wide at the floor) and was pinned to the pane's left edge, so after a scroll of about 80 px it covered every field's Read and Edit box, and below 1304 px of pane the boxes could not be clicked at all. The whole field panel (filter, count, bulk buttons, legend and the field table) now holds its place at the expanded cell's inset and is no wider than the pane shows, on both the Studio Access matrix and the metadata-admin one. Every box stays in view and clickable at any scroll offset, and the field name beside it stays readable. Nothing changes where the pane holds the whole matrix.
