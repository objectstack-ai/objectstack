---
'@object-ui/i18n': patch
---

feat(i18n): the `studio` namespace gains `engine.studio.rail.clearSearch` (en "Clear search", zh "清除搜索")

Clause-②: no
Metadata-protocol: none

The Studio rails (Data, Automations, Access) now share one empty-search state: a search that matches nothing names the query under the box and offers a "Clear search" action that empties the box and puts every row back. This row is that action's label; the sentence reuses the existing `engine.list.emptyQuery` row.
