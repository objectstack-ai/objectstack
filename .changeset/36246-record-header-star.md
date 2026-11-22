---
'@object-ui/app-shell': patch
---

feat(app-shell): the record's favorite star sits beside its name, and the header's `⋯` no longer holds "Add to favorites"

Clause-②: no
Metadata-protocol: none

The record page draws its favorite star right of the record's name, always visible: hollow until the record is a favorite, filled once it is, one press to toggle with no confirm. The full page, a drawer or split-pane preview, and a phone's record page all draw it, from the same favorite the sidebar's Favorites section reads, so nothing about the stored favorites or that section changes. The header's `⋯` menu drops its "Add to favorites" / "Remove from favorites" entry, so the page keeps one favorites control. A print page, which draws no record header and so no star, keeps the entry in its chrome row's `⋯`.
