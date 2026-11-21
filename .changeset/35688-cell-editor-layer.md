---
'@object-ui/components': patch
'@object-ui/plugin-grid': patch
---

feat(grid): the inline cell editor floats over its cell, so the row keeps its height; a selected cell that is cut off shows its whole value

Clause-②: no
Metadata-protocol: none

In `data-table` (and so in every grid `ObjectGrid` draws):

- **The editor draws on a layer over the cell** instead of inside it. The layer's top-left corner sits on the cell's, it is at least as wide as the column and grows wider or taller where the editor needs it (an address form, a record picker, a multi-line text), and neither the row's height nor any column's width changes. Near the bottom of the window it opens upward, near the right edge it shifts left, and its height is capped at the space left, scrolling inside. A cell partly hidden behind a frozen column, a right-pinned column or the sticky header is scrolled clear first; scrolling the cell out of sight commits the edit, as a click outside does. The layer stays inside the cell's DOM, so click-outside, Escape, Enter / Tab and focus behave as before. Tab inside the layer goes where it went before: the select-first grid commits and moves, other grids let the browser move focus.
- **`ObjectGrid` sizes the layer per field type**: an address or location starts 22rem wide, a multi-line text, markdown, code or JSON 20rem, a lookup, master-detail or user 18rem, a multi-select, tags or checkboxes 16rem, a date, date-time, phone, URL, email or currency 14rem, anything else 10rem; never narrower than its cell.
- **On the select-first grid** (the list page), a selected cell whose value the column cuts off shows it in full on a layer over the cell, wrapped and scrolling past a few lines. Escape, an arrow key or a click elsewhere closes it; Enter or a double-click turns it into the editor in the same place and at least the same size. Enter on a checkbox cell flips it, as Space and a second click already did, instead of opening an editor.
