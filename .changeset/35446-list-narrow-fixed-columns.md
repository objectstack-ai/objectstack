---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/app-shell': patch
---

fix(grid): a list in a narrowed main area keeps every data cell clear of its fixed columns, shows its horizontal scrollbar, and draws a short header

Clause-②: no
Metadata-protocol: none

- **Row actions column.** While a list's table is wider than its box (the AI panel docked, a small window, the record drawer open), the row actions column (the row's "⋮") is drawn right after the frozen name column and frozen with it, instead of pinned to the right edge, where it covered the data column reaching that edge (an amount cut to 「¥94,0」). Every data column then scrolls sideways under the frozen columns, and none is covered at rest. Once the box is wide enough for the whole table again, the column goes back to the right edge, so a list that fits looks as before. Inline primary row actions still fold into the "⋮" menu first, as before. Columns an author pinned to the right stay where the author put them; the grouped list is unchanged.
- **Horizontal scrollbar.** A table wider than its box draws its scrollbar at rest instead of only while the pointer is over it, so columns out of view are announced. A table that fits keeps the scrollbar that shows on hover.
- **List header.** While the list page's header is narrower than 768 px, it draws no description, and Import moves into the 「⋯」 menu beside New. A wider header is unchanged. This is opt-in: the console `PageHeader` gains `compactBelow` (a width in px; below it the one-row header drops its description and draws its folded actions), which only the list page passes, so other pages that use `PageHeader` are unchanged. Setup's two-line header ignores it.
- No column is hidden and no column configuration changes.
