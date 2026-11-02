---
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-list, app-shell): one "Personalized" marker beside the list title holds the one reset to the view

Clause-②: yes (widening)
Metadata-protocol: none

- **The marker.** While a reader's list differs from its view, the Console draws a **Personalized** marker beside the list title (in the page header, and beside the phone title as an icon alone). Opening it names what differs (filters, search, sort, grouping, column layout, hidden fields, density, layout, row color, row numbers, inline editing) and holds **Reset to view**, with a sentence saying what it covers and what it leaves alone. It is not configurable: no metadata key or option.
- **The one reset.** It drops the active view's stored entry and the cached search term, removes the reader's whole `uf_*` family from the address bar (Filter panel, search, sort, grouping and every user-filter chip), and opens the list again, so a reload or Back does not bring the old list back. Not list state, so untouched: the record-open preference, pinned views and their order, favorites, and a "View all" link's `filter[...]` scope.
- **Gone.** The header ⋯ entry "Reset view", and, on the Console list, the Display panel's "Reset to view default". The sort popover's reset and the Filter panel's "Clear all" stay: each puts back one control.
- **`ListView` (`@object-ui/plugin-list`)** gains one optional host prop, `onPersonalizationChange(parts)`, reporting which parts of the list on screen differ from the view (`sort`, `filters`, `search`, `grouping`, `hiddenFields`, `density`, `layout`, `rowColor`, `rowNumbers`, `inlineEdit`; `columns` is in the part type for a host to add). With it the Display panel draws no reset of its own; without it nothing changes. `viewDefaults` also accepts `grouping`, the view's own grouping under one the host laid over it; a `viewDefaults` without that key leaves the grouping `schema` opened with as the view's.
- **Copy (`@object-ui/i18n`).** New `console.objectView.personalized`, `personalizedHeading` and `personalizedParts.*` in all ten packs; `console.objectView.resetView` and `resetViewTitle` now label the marker's reset and say everything it covers. No key is removed.
