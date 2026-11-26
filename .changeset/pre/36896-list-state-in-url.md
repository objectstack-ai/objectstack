---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the metadata list keeps its search, filters, sort and scroll position across a trip to an item and back

Clause-②: no
Metadata-protocol: none

The generic metadata list (Setup's catalog lists and Studio's "All metadata" area) held its search text, its source filter, "only customizations" and the activation status filter in component state, so opening an item and coming back, or refreshing the page, reset all of them. They now live in the list's address as page-scoped params: `q` (search), `source` (`artifact` / `runtime`), `customized=1`, `status` (`active` / `inactive`) and the new `sort`. A value at its default is left out, so an untouched list keeps its clean address, and every change replaces the history entry instead of adding one, so Back leaves the list rather than paging through keystrokes. The `package` and `scope` params keep their meaning.

The list gains a sort control: by API name or by label, each way. The default is by API name, A to Z; before this change the list kept the server's order.

Each row link now carries the list's non-default params to the item page, and the scroll position of the list is restored when the same list address is shown again in the same tab (Back, or a link to the list with the same params).

New module `metadataListState.ts` beside the page holds the codec, the list's filter and sort (`applyListState`) and `orderedListNames`; the new `useListOrderedNames(type)` hook gives an item page the names of its list in that order, read from its own address — every item of the scope by API name when the address carries no list context. Neither is exported from the package root.

New locale keys in the studio catalogue (en, zh): `engine.list.sort`, `engine.list.sort.name.asc`, `engine.list.sort.name.desc`, `engine.list.sort.label.asc`, `engine.list.sort.label.desc`.
