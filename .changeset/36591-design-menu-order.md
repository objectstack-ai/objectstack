---
'@object-ui/app-shell': patch
---

fix(app-shell): a menu reordered in design mode is saved in the order the sidebar draws it, in apps whose menu entries carry `order`

Clause-②: no
Metadata-protocol: none

The sidebar sorts each level of an app's `navigation` by `order` (lower first, an absent `order` as 0, ties in array order), but design mode listed and saved the array as authored. In an app whose entries carry `order` — AI-built apps write one on every entry — 「Move up」, 「Move down」, 「Move to group」, a drag and an added item were saved and published without error and changed nothing on screen; re-entering design mode then listed the menu in an order the sidebar did not show.

Design mode now lists each level in the sidebar's order, and the save writes that order back: every level in which any entry carries `order` has each of its entries, groups and group children alike, renumbered `0`, `1`, … in the order design mode showed. A level in which no entry carries `order` is saved by array order as before and gains no `order` key, so apps authored by array order (HotCRM's) are unchanged. Saving a menu with `order` therefore rewrites its `order` values to consecutive numbers; the order they draw is the one design mode showed.
