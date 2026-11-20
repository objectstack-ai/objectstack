---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

fix(plugin-list): a list's column header opens a menu and keeps a multi-level sort; a sort chip opens the sort panel

Clause-②: yes (widening)
Metadata-protocol: none

On a list page (the grid `ListView` draws), a click on a sortable column header no longer sorts at once. It opens the column menu: sort ascending, sort descending, hide the column. Enter, Space or ArrowDown on the focused header opens the same menu, the arrows move through it, Enter chooses, and Esc shuts it without touching the sort. With no sort or a single level, the column picked in the menu replaces the sort; with two levels or more it becomes the first level, the other levels keep their order after it, and a column already in the sort moves up with the picked direction. No level is dropped. The ↑1 / ↓2 marks on the headers are unchanged.

A sort chip under the view bar no longer reverses its direction on a click: it opens every sort level in one panel. Each level row in the sort builder now has a handle; dragging it, or ArrowUp / ArrowDown on the focused handle, reorders the levels.

New public surface, all additive: `GridHeaderMenuProvider` and `useGridHeaderMenu` from `@object-ui/components` (a host opts a data-table into the header menu; without it a header click sorts as before, so related lists, dashboard tables and every other host keep click-to-sort); the `headerMenu` runtime prop on `ObjectGrid`; and the `sortBuilder.reorder` key in every `@object-ui/i18n` locale. The column menu itself is now a menu (`role="menu"` entries, keyboard reachable) wherever it opens, including a right-click on a header and the design host's caret.
