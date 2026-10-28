---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): a grouped list on a phone draws its group headers and cards instead of the desktop table

Clause-②: no
Metadata-protocol: none

Below the 768px card breakpoint, `ObjectGrid` turned a plain list into one card per row but kept a grouped list (`grouping`) on its desktop table, so on a phone the titles were cut mid-word and every other column sat behind the pinned Actions column. A grouped list now takes the plain list's card layout: each group's header (its toggle, label and count), then that group's rows as the same cards, then, on a server-grouped list, the group's own pager. Collapsing a group hides its cards, and the grouped pager still pages whole groups. At a desktop width the grouped table is unchanged, and so is the plain list's card view, which now draws through the same card renderer.

What to do: nothing.
