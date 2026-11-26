---
'@object-ui/plugin-detail': patch
---

feat(console): a double-click on the record page's details divider resets the left column to its default width

Clause-②: no — no public type or accept set; one interaction on an existing control
Metadata-protocol: none

On a wide full record page the details are pinned to a left column, with a divider between them and the tabs that can be dragged or moved with the arrow keys, and the width is kept per reader and per object. A double-click on that divider now puts the column back to its default of 400 px and keeps that width, so the next record of the same object opens at the default too. A drag the double-click interrupts ends with it. The limits, the keyboard moves and the comment panel are unchanged.
