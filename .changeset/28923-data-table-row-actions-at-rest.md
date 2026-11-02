---
'@object-ui/components': patch
---

fix(components): the data-table's row ⋯ trigger is visible at rest, in a muted tone, instead of appearing only under the pointer

Clause-②: no
Metadata-protocol: none

The `data-table` renderer draws an Actions column header whenever its rows carry actions, but each row's ⋯ trigger was hidden by opacity on a fine pointer until the pointer reached the row, so a desktop table showed a headed column of cells that looked empty and read as "no actions available". The trigger is now drawn on every row at rest in the muted foreground tone, on every pointer type alike, and turns full strength on row hover, focus within the row, a selected row, its own keyboard focus, while its menu is open and on a coarse pointer, the same treatment the list grid's row menu has. The menu's items, their gates and their order are unchanged. The Console list's per-row "open as page" link keeps its hover reveal; only its code comment, which claimed it matched the row menu, is corrected. No key, option or prop is added.

What to do: nothing.
