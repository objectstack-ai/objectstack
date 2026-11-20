---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

fix(list): the list page lines up on one 16px left edge; the checkbox column is 40px at any width; no row numbers

The list page drew five different left edges, and on a list with more columns than fit, the selection column was squeezed to the checkbox's own 16px, flush against the left of the page. Now the page bar's object icon, the view bar's view icon, the header's select-all box, every row's checkbox and the footer's record count all start 16px in, and the selection column is 40px (16px in, the 16px box, 8px before the first column) on a list that scrolls sideways, on one that fits, and after scrolling sideways and back. The view bar's last text trigger ends 16px in, where the page bar's button ends.

The grid no longer draws row numbers unless a host asks for them (`showRowNumbers`): each row's leading cell is its checkbox, shown at rest rather than on hover. This applies to every grid, the list page, related lists and the designers' grids among them. A grid whose authored columns all fail to resolve now says it renders "NO data columns" in its console diagnostic, since it no longer draws a row-number column.
