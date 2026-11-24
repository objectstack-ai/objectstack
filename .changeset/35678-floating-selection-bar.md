---
'@object-ui/plugin-grid': patch
'@object-ui/components': patch
'@object-ui/types': patch
'@object-ui/app-shell': patch
---

feat(plugin-grid): selected rows get one small bar floating at the bottom centre of the list

Clause-②: yes (widening)
Metadata-protocol: none

Selecting rows in a grid now shows one bar floating at the bottom centre of the list area: 「已选 N 条」 and ×, up to three labelled actions, and the rest under 「更多」. When the selection offers no more than three actions they are all buttons, so a lone Delete is a button; over three, Delete goes behind 「更多」 with the rest. The bar sits above the footer calc row, the list keeps room after its last row so that row scrolls fully clear of the bar, and when every loaded row is selected and more match, the bar offers 「选择全部 N 条」. × or Esc clears the selection; Esc that belongs to a field, or to another open menu or dialog, does not.

The same bar serves the object list page, a record's child-table tabs, the side record and embedded tables. The old bottom strip and the list page's 「已选」 face in the view bar are both retired, so the top of the list page no longer changes when rows are selected. On the list page, where rows draw no actions of their own, one selected record offers that record's actions; elsewhere the bar offers the bulk actions at any count. A narrow list gives actions back to 「更多」 until the bar fits on one line.

- `@object-ui/plugin-grid`: `BulkActionBar` is redrawn as the floating bar; its props gain `singleRowMenu`. `useListPageScope(scope)` replaces the unpublished `useListPageBarHost`.
- `@object-ui/types` / `@object-ui/components`: `DataTableSchema.floatingBar` is a runtime slot (refused by the zod twin like the other runtime slots). The table floats it over its scroll box, above its summary row, with room after its last row.
- `@object-ui/app-shell`: the list page header and the view bar no longer swap to a selection face.

This supersedes the selection behaviour in the list-page entry of this release (no Actions column on the list page): the selection is no longer shown in the page bar, up to three actions are buttons and a lone Delete is one, and grids outside a list page no longer draw a bottom bulk bar.
