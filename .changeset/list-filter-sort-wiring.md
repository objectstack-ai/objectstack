---
'@object-ui/plugin-list': patch
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(plugin-list): the list's Filter and Sort open the shared field list, and the conditions show as chips under the view bar

Clause-②: no
Metadata-protocol: none

The toolbar's Filter opens a searchable field list (the fields the view shows first, a type icon on each), then the values by field type; every pick applies at once. Sort opens the same list with the direction on top. Under the view bar, the condition row shows the sort chips first (click to reverse, drag or Alt+Arrow to reorder, × to remove), then the view's own conditions as locked chips, then the reader's filter chips, 「Add filter」 and 「Reset」, which puts the filter and sort back to the view as saved. A column header click shows up there as a sort chip. The full FilterBuilder and SortBuilder stay one click away, behind 「Advanced filter」 and 「All sort levels」. The FilterBuilder no longer draws its 「Where」 label: `filterBuilder.where` is retired from the locale packs, and `listConditions.sort.advanced` is added. No filter storage format, `uf_*` parameter or server sort changes.
