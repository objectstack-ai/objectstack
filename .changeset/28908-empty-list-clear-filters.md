---
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

feat(plugin-list): a list emptied by a filter the reader applied offers "Clear filters" as its primary action

Clause-②: yes (widening)
Metadata-protocol: none

A list whose own filter panel or "In a queue" toggle left it with no rows said to adjust or clear the filters, and its only button was "Add record", which creates a record while the list is filtered. Now:

- **Filtered by the reader:** the empty state draws "Clear filters" as the primary button and "Add record" as the secondary one. A click removes the reader's whole query (the filter panel's conditions, the "In a queue" toggle and the search), so the toolbar's filter badge clears and the rows come back. The cleared panel group is emitted through `onFilterChange` like any panel edit, so a host that stores it stores the empty group.
- **Searched only:** unchanged. "Clear search" sits beside the primary "Add record".
- **Filtered by the view only:** no clear action. The view's declared filter is not the reader's, and "Clear filters" never removes it.
- **User-filter chips** are not cleared by this action: each chip clears in place.

`@object-ui/i18n` gains one string, `list.clearFilters` ("Clear filters"), in every locale pack.
