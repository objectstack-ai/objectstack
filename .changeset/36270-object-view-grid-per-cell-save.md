---
'@object-ui/plugin-view': patch
---

feat(object-view): an editable object-view grid selects a cell first and saves each cell on its own, with no Save All

Clause-②: no
Metadata-protocol: none

The grid an `object-view` draws itself (the registered renderer with no `renderListView` host, such as the Studio's view preview) now edits as the list page's grid does when the view makes it editable, through the named view's `inlineEdit` or, without one, `table.editable`. A click selects a cell; double-click, Enter, F2 or typing opens its editor; Esc cancels; and each committed cell is saved at once as one update for its record. The pending-changes bar, its "Save All" and "Cancel All" buttons and the per-row save column are no longer drawn there.

A read-only object-view grid is unchanged: a click on a row still opens the record. The editing grant is unchanged too: neither key can open editing that the object or the reader's `update` grant refuses, and a refused cell now says why when it is asked to edit, as on the list page.
