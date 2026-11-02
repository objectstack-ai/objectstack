---
'@object-ui/plugin-list': patch
---

feat(plugin-list): a phone list offers Sort and its own search

Clause-②: no
Metadata-protocol: none

Below the `sm` breakpoint the list toolbar used to draw only Filter and Display: Sort and the list-scoped search were hidden, and the only way to find a record by name was the global search. Now:

- **Sort** rides in the Display panel below `sm`, the same Sort panel the toolbar's Sort popover draws, so the bar gains no button. Below `sm` the Display panel now takes the phone's width, as the Filter and Sort panels do. A toolbar with no Display panel (`compactToolbar: false`, or nothing else to display) keeps the Sort button on the bar at every width.
- **Search** is an icon that expands into a field in place. Enter or Escape folds it back to the icon, which then shows the active keyword; the clear button empties the term and folds it.

Both follow the same `userActions.sort` / `userActions.search` flags as the desktop toolbar, and a list whose search resolves to no field still draws none. Nothing a view declares changes.
