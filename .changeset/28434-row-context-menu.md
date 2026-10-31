---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
---

feat(plugin-grid): right-clicking a list row opens that row's actions at the pointer; a row inside a multi-row selection opens the selection's bulk actions

Clause-②: yes (widening)
Metadata-protocol: none

A list row's actions were reachable only through the small ⋯ button at the far right of the row. A right-click on the row now opens them where the pointer already is. Nothing new is declared: the menu is a second way to reach what `list_item` actions, `userActions.edit` / `delete` and the view's bulk actions already declare.

- **A row's menu is its ⋯ menu.** Open and Open in new tab (the record URL the row's link cell draws, when the host publishes one), then the row's actions from the same resolver the ⋯ cell reads: same capability gate, same per-record `visible` / `visibleWhen`, same order, same handlers and confirm dialogs. An action that is hidden for a row is absent from both. The inline primary buttons the cell shows beside the ⋯ are listed too, above the secondary actions, since a menu has no width budget.
- **A row inside a selection of two or more opens the selection's menu.** The bulk actions `BulkActionBar` offers, from the bar's own resolver, with the selection count and Clear. It never lists a single-record action. A row outside the selection, or a selection of one, opens the row's own menu.
- **The browser's menu stays where it is the useful one:** on a link in a cell, on an input or a cell in edit mode, when text is selected in the row (copying from a list keeps working), and on a touch long-press (touch keeps the ⋯ button). A grid that offers no row action at all, and whose rows cannot be selected, keeps it too; on a grid that does, a row whose own actions are all hidden by their predicates still opens Open and Open in new tab.
- **Keyboard:** the context-menu key and Shift+F10 on a focused cell open the same menu below it. Esc closes it and focus goes back to the cell.
- **Related-list tables** get the same menu from `data-table`'s own row menu: Open, then that row's ⋯ items. They have no record URL to open in a new tab, and no bulk actions, so a row inside a selection of two or more keeps the browser's menu there.
- **New runtime slot `DataTableSchema.renderRowContextMenu`.** `(row, { selected }) => ReactNode`, supplied by the host; `data-table` owns the menu around the items it returns, and `null` keeps the browser's menu. It is a function, not metadata, so the zod mirror refuses an authored value by name.
