---
'@object-ui/plugin-grid': patch
---

fix(plugin-grid): the list grid's row ⋯ trigger is visible at rest, in a muted tone, instead of appearing only under the pointer

Clause-②: no
Metadata-protocol: none

The Actions column header is always drawn, but each row's ⋯ trigger was hidden by opacity on a fine pointer until the pointer reached the row, so a desktop list showed a headed column of cells that looked empty and read as "no actions available". The trigger is now drawn on every row at rest in the muted foreground tone, on every pointer type alike, and turns full strength on row hover, focus within the row, a selected row, its own keyboard focus, while its menu is open and on a coarse pointer. The menu's items, their gates and their order are unchanged. No key, option or prop is added.

What to do: nothing.
