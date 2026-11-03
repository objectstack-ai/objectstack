---
'@object-ui/plugin-list': patch
---

feat(plugin-list): the list's empty-state "Clear filters" also clears the user-filter chips, so a list emptied by a chip alone offers it

Clause-②: yes (widening)
Metadata-protocol: none

A list emptied by a user-filter chip alone (the quick-filter chips above the grid) said "No records match your current filters or search" and offered only "Add record": the chip kept its selection inside `UserFilters`, out of the list's reach. It now offers "Clear filters" as its primary action, as a list emptied by the filter panel or the "In a queue" toggle does, and one click clears the chips with the rest of the reader's query.

- **`UserFilters` takes an optional `ref`** that receives a `UserFiltersHandle` (exported from `@object-ui/plugin-list`) while a dropdown or toggle bar is mounted. Its `clear()` empties every chip, author defaults included, exactly as pressing each chip's × would: `onFilterChange` receives no conditions, and `onSelectionsChange` reports every chip field with an empty selection, so a host that persists selections per field (the console's `uf_*` URL params) drops each one. The selection stays the bar's own state, and the bar is not remounted. A host that passes no ref gets the bar unchanged.
- **Preset tabs are not cleared.** A tab is one of the view's presets, not a filter the reader added: tabs mode sets no handle, and a list a tab empties still offers no clear action.
- No metadata key, option or copy changes.
