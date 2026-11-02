---
'@object-ui/plugin-list': patch
'@object-ui/plugin-tree': patch
---

fix(ui): a tree list view draws the view's authored empty state, and the tree's load failure is translated

Clause-②: no
Metadata-protocol: none

- **Empty tree views.** A list view shown as a tree now draws the same empty state as the grid and the gallery: the view's authored `emptyState` (title, message, icon, link) first, otherwise the localized "Nothing here yet" copy, with the same Create, Clear search and Clear filters actions. It used to draw the tree's generic "No data" line, so guidance authored on the view was lost on that layout. The list toolbar stays above it.
- **Tree load failures.** A tree whose read fails shows the translated "Couldn't load records" title with the error's own message under it, in the alert panel the list uses, instead of the English line "Failed to load tree: …" on every page.

No metadata key or option is added.
