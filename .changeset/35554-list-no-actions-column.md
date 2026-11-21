---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(list): the object list page has no Actions column, and a list with no declared pagination loads as it scrolls

Clause-②: no
Metadata-protocol: none

- **No Actions column on the list page.** The list's rows carry no control: no Actions column and no "⋮" at the row end, on hover or at rest. A row's actions are reached by selecting it or by right-clicking it. Grids outside a list page (related lists, page blocks, the record drawer) keep their Actions column.
- **Context menu.** In a row's menu (its context menu, and the "⋮" where one is still drawn) Delete is the last item, after a separator, in the danger colour; a selection's menu closes with its destructive actions the same way.
- **Checkboxes.** The whole leading cell toggles a row, and Shift extends the selection over the rows between the last toggled row and this one.
- **Scroll loading.** A grid list view that declares no `pagination` draws no pager: it loads 50 rows and the next 50 as the list nears its end, and shows the match total beside the view name. With every loaded row ticked, the selection offers 「选择全部 M 条」 (capped at 5000 as before). Opening a record on its own page and coming back returns to the same place in the list. A view that declares `pagination` keeps its pager. Footer totals are still computed by the server over every matching record.
