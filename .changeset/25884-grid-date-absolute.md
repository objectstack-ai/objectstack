---
'@object-ui/fields': patch
'@object-ui/plugin-grid': patch
---

fix(fields,plugin-grid): a grid's `date` column reads in one absolute face when its field declares no `format`

Clause-②: no
Metadata-protocol: none

A list grid's `date` column used to mix three faces in one column, for example "Yesterday · 3 days ago · Sep 25 · Sep 20, 2025". The cell's default face was `'relative'`, which writes a relative phrase within ±7 days of today and an absolute date outside that window. A sorted column did not look sorted, and "Yesterday" in an expiry column read as a status.

- **Default change for an undeclared `format` (visible from metadata).** In a grid column, a `date` field that declares no `format` now renders the locale's short absolute date: `Oct 25`, with the year added when the date is not in the current year. Every row of the column uses this one face. The group headings of a grid grouped by that field change with it, so a heading still reads like the cell under it.
- **The relative phrase moves to the tooltip.** It is shown on hover ("Yesterday", "In 2 days", or "Overdue 3d" on a declared `dueLike` field). A date outside the ±7-day window has no relative phrase, so it keeps its ISO `title` as before. A past declared deadline is still red.
- **A declared `format` still wins.** A field that declares `format: 'relative'` keeps the relative face in the grid. This is how an author who wants relative wording in a list keeps it.
- **Other surfaces are unchanged.** The record detail body, the header highlights strip, kanban and gallery cards, the tree, a record page's related list and the grid's record panel render `date` cells as before. `DateCellRenderer` paints the absolute default only when its host passes the new `inGridColumn` prop, and `ObjectGrid` passes it on every column it builds. On mobile, a grid card draws its title through the column's cell, so a `date` title reads absolute there too; the card's other date slots were already absolute. `datetime` cells are not affected, because their default face was already absolute (`compact`).

What to do: nothing. To keep the relative wording in a grid column, declare `format: 'relative'` on the field.
