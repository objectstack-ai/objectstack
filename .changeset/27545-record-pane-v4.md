---
'@object-ui/plugin-grid': patch
'@object-ui/plugin-list': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(plugin-grid,plugin-list,app-shell,i18n): record pane v4 in the console — a record opens beside the list by default, ⤢ maximizes it in place on the same URL, and the full page opens only from the row's ↗ and the record header's ⋯ (#27545)

Clause-②: yes (widening)
Metadata-protocol: none

No metadata key is added, removed or read differently: every change is in how the console opens a record from a list, and in the reader's own preference. The mechanics (the split face, the non-modal drawer, maximize, the list's narrowed faces) shipped in the change before this one.

- **`@object-ui/app-shell`**
  - The object page opens a record beside the list unless the reader prefers the drawer (Display menu); a reader who prefers the full page gets it from a row click. Below a 1000 px content area the pane is a non-modal drawer over the list.
  - The list is one element whatever the pane does, so it keeps its scroll. A click on another row swaps the pane's root record. The open row is tinted, follows ↑ ↓ and scrolls into view.
  - A `?recordId=` change (a row click, a step) re-renders none of the list: the router's setter and the list's handlers no longer change identity with the URL.
  - The bar's ⤢ maximizes the pane in place and no longer routes; nested levels share it. The full page opens from the row's ↗ and from the record header's `⋯`, whose last host item is 「Open as full page」. 「Collapse to drawer」 is drawn only on a page the ↗ opened.
  - A step keeps the record on screen until the next one arrives, and ↑ ↓ warm the related counts of both neighbours.
- **`@object-ui/plugin-list`**
  - The Display menu's Open records section draws a third segment, Full page, when the host passes the new optional `recordOpen.selectPage`; a host that passes none sees two segments, as before, but now in the order Split | Drawer (it was Drawer | Split), since Split is the default. `recordOpen.preference`, an input the section only reads, also accepts `'page'`. `setPreference` still takes `'split' | 'drawer'`, so a host's setter keeps its type. The note says a record's ↗ always opens the full page.
  - Beside a record pane the record-count bar no longer prints the count (the console prints it under the list); the rest of the row stays.
- **`@object-ui/plugin-grid`**: narrowed beside a pane, the row-actions column keeps its header's accessible name but draws no label, so it is only as wide as its ⋮.
- **`@object-ui/i18n`**: `list.recordOpenPage` in all ten packs, and `list.recordOpenNote` reworded in all ten.
